/**
 * One scheduled pass on a real mailbox: lock, details, models, triage, inbox-zero asks, approved actions, state.
 * @req FR:email-runner/cli.run @req FR:email-runner/cli.lock @req FR:email-runner/state.file
 */
import { randomBytes } from 'crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync, writeSync } from 'fs';
import { dirname, join } from 'path';
import type { LifecycleContext } from '../core/lifecycle';
import { createGraphActions, createGraphMail, messageDetails } from './graph-mail';
import type { Transport } from './guard';
import { approvedMoves, emptyState, type Http, type HygieneState, type MailState } from './hygiene';
import { createClaudeJson, type ClaudeJson } from './llm';
import { createClassifier, createDrafter, createJudge, newUsage } from './models';
import { DEFAULT_RULES, type RulesConfig } from './rules';
import { runTriage } from './run';
import { resolveAsk, type RunSummary } from './to-ask';
import type { Classifier, MailProvider, Message, TriageResult } from './types';
import { loadVoice, voicePath } from './voice';

export const LOCK_STALE_MS = 30 * 60_000;
export const LOCK_HEARTBEAT_MS = 5 * 60_000;
export const DEFAULT_MAX = 200;
export const DEFAULT_SINCE_DAYS = 14;

export type PassSummary = RunSummary & { modelCalls: number; costUsd: number; modelErrors: number };
export interface RunnerState { version: 1; cursor?: string; sentCursor?: string; hygiene: HygieneState; lastRun?: string; lastSummary?: PassSummary }

const dir = (account: string, base?: string) => dirname(voicePath(account, base));
export const statePath = (account: string, base?: string) => join(dir(account, base), 'state.json');
export const lockPath = (account: string, base?: string) => join(dir(account, base), 'run.lock');
export const rulesPath = (account: string, base?: string) => join(dir(account, base), 'rules.json');

/** Reads the mailbox state; a missing file is a fresh start. @req FR:email-runner/state.file */
export function readState(path: string): RunnerState {
  if (!existsSync(path)) return { version: 1, hygiene: emptyState() };
  const s = JSON.parse(readFileSync(path, 'utf8')) as RunnerState;
  if (s?.version !== 1 || !s.hygiene) throw new Error(`Not an email state file: ${path}`);
  return s;
}
/** Atomic write, mode 0600, in a 0700 directory. */
export function writeState(path: string, s: RunnerState): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(s)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * One pass per mailbox. The lock holds a token, is touched every 5 minutes while held, and is released only by its owner.
 * A lock untouched for 30 minutes is stale: it is renamed aside (one taker wins the rename) and re-checked before taking over.
 * @req FR:email-runner/cli.lock
 */
export function takeLock(path: string, now = () => Date.now()): (() => void) | null {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const token = `${process.pid}.${randomBytes(8).toString('hex')}`;
  const create = () => { try { const fd = openSync(path, 'wx', 0o600); writeSync(fd, token); closeSync(fd); return true; } catch { return false; } };
  if (!create()) {
    let age = 0;
    try { age = now() - statSync(path).mtimeMs; } catch { /* gone: try to create */ }
    if (age < LOCK_STALE_MS && existsSync(path)) return null;
    const aside = `${path}.stale.${token}`;
    try { renameSync(path, aside); } catch { /* another taker won, or it vanished */ }
    if (existsSync(aside)) {
      // Renamed a lock that was refreshed in the meantime: put it back and stay out.
      if (now() - statSync(aside).mtimeMs < LOCK_STALE_MS) { try { renameSync(aside, path); } catch { /* ignore */ } return null; }
      rmSync(aside, { force: true });
    }
    if (!create()) return null;
  }
  const beat = setInterval(() => { try { if (readFileSync(path, 'utf8') === token) { const t = new Date(now()); utimesSync(path, t, t); } } catch { /* lost */ } }, LOCK_HEARTBEAT_MS);
  beat.unref?.();
  return () => {
    clearInterval(beat);
    try { if (readFileSync(path, 'utf8') === token) rmSync(path, { force: true }); } catch { /* already gone */ }
  };
}

export class MaxExceeded extends Error {
  constructor(readonly found: number, readonly max: number) { super(`Delta returned ${found} messages; more than --max ${max}`); this.name = 'MaxExceeded'; }
}

/**
 * Adds headers, own text and read state to the newest message of each conversation (the only one triaged).
 * More than `max` messages stops the pass before any detail read or model call, so nothing is skipped.
 * @req FR:email-runner/graph.details @req FR:email-runner/cli.run
 */
export function withDetails(provider: MailProvider, details: (id: string) => Promise<Pick<Message, 'headers' | 'body' | 'isRead'>>, max: number): MailProvider {
  return {
    ...provider,
    async delta(cursor) {
      const r = await provider.delta(cursor);
      if (r.messages.length > max) throw new MaxExceeded(r.messages.length, max);
      const newest = new Map<string, Message>();
      for (const m of [...r.messages].sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))) newest.set(m.conversationId, m);
      const messages: Message[] = [];
      for (const m of r.messages) messages.push(newest.get(m.conversationId) === m ? { ...m, ...(await details(m.id)) } : m);
      return { messages, cursor: r.cursor };
    },
  };
}

/** Messages in a row whose model calls all fail: the model is down, not the message. */
export const MODEL_FAIL_LIMIT = 3;
/** Usage-limit errors: no retry or next message helps until the limit resets. Rate limits and overloads are transient, so they retry. */
const LIMIT_ERROR = /\b(usage limit|credit balance)\b/i;
/** What a signed-out `claude` prints (stderr or JSON `result`); kept narrow so a message or model text cannot match it. */
const AUTH_ERROR = /(please run \/login|not logged in|invalid api key|oauth token (has )?expired|authentication_error)/i;
/** The one ask a model-down pass writes, for every mailbox (they share one `claude` login). @req FR:email-runner/model.down */
export const CLAUDE_LOGIN_ASK = 'email-claude-login';
export const CLAUDE_LOGIN_TEXT = 'Claude login expired: run `claude` and sign in';
export const CLAUDE_DOWN_TEXT = 'Claude calls are failing: run `claude` to check sign-in and usage';

/** The model is unusable for the whole pass (signed out, or failing on every message). @req FR:email-runner/model.down */
export class ModelUnavailable extends Error {
  constructor(readonly detail: string, readonly auth: boolean) { super(`${auth ? CLAUDE_LOGIN_TEXT : CLAUDE_DOWN_TEXT} (${detail.slice(0, 200)})`); this.name = 'ModelUnavailable'; }
}

/**
 * A message whose model calls fail twice goes to the owner as an open question, so it is never lost or billed again.
 * A login or usage-limit error, or {@link MODEL_FAIL_LIMIT} messages failing in a row, is systemic: it throws {@link ModelUnavailable} to stop the pass.
 * `check()` throws too when every message in the pass failed (a small scheduled pass never reaches the limit).
 * @req FR:email-runner/model.classify @req FR:email-runner/model.down
 */
export function tolerant(c: Classifier, onError: () => void): Classifier & { check(): void } {
  let inRow = 0; let ok = 0; let failed = 0; let last = '';
  const text = (e: unknown) => (e instanceof Error ? e.message : String(e));
  return {
    check() { if (failed && !ok) throw new ModelUnavailable(last, false); },
    async classify(m, o) {
      for (let i = 0; i < 2; i++) {
        try { const r = await c.classify(m, o); inRow = 0; ok++; return r; } catch (e) {
          last = text(e);
          if (AUTH_ERROR.test(last)) throw new ModelUnavailable(last, true);
          if (LIMIT_ERROR.test(last)) throw new ModelUnavailable(last, false);
        }
      }
      onError(); failed++;
      if (++inRow >= MODEL_FAIL_LIMIT) throw new ModelUnavailable(last, false);
      return { class: 'needs_decision', urgency: 1, confidence: 0, reason: 'Could not classify (model error); open it to decide' };
    },
  };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * Rules for a mailbox: the account is the owner, plus `rules.json` next to the state when present. Lists add to the defaults.
 * `sensitive` is a list of addresses and domains, or `{ keywords, domains }`. @req FR:email-runner/cli.run @req FR:email-triage/rules.sensitive
 */
export function rulesFor(account: string, base?: string): RulesConfig {
  const p = rulesPath(account, base);
  const extra = (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}) as Record<string, unknown>;
  const s = extra.sensitive && typeof extra.sensitive === 'object' && !Array.isArray(extra.sensitive) ? (extra.sensitive as Record<string, unknown>) : undefined;
  const add = (k: keyof RulesConfig, ...more: unknown[]) => [...new Set([...DEFAULT_RULES[k], ...strings(extra[k]), ...more.flatMap(strings)])];
  return {
    owner: [...new Set([account, ...add('owner')])], vip: add('vip'), sensitive: add('sensitive', s?.domains), sensitivePatterns: add('sensitivePatterns'),
    sensitiveKeywords: add('sensitiveKeywords', s?.keywords), receiptSenderPatterns: add('receiptSenderPatterns'), receiptSubjectPatterns: add('receiptSubjectPatterns'),
  };
}

export interface PassOptions {
  ctx: LifecycleContext;
  account: string;
  transport: Transport;
  mode: 'observe' | 'drafts';
  rules?: RulesConfig;
  project?: string;
  max?: number;
  /** A first pass (no cursor) looks back this many days. */
  sinceDays?: number;
  llm?: ClaudeJson;
  http?: Http;
  dataDir?: string;
  /** Keeps state in memory and writes nothing to the mailbox. */
  dryRun?: boolean;
  /** Gets the triaged results after a successful pass (the Inbox page writer). Never called on a dry run. @req FR:inbox-page/run.email */
  onResults?: (results: TriageResult[]) => Promise<void>;
}

/**
 * Runs one pass. Inbox-zero state is saved on every change (so a move is never repeated after a crash); the delta cursor
 * only after the whole pass succeeds, so a failed pass never skips mail. @req FR:email-runner/cli.run @req FR:email-runner/state.file
 */
export async function runPass(o: PassOptions): Promise<PassSummary> {
  const sPath = statePath(o.account, o.dataDir);
  const st = readState(sPath);
  const now = (o.ctx.now ?? (() => new Date()))();
  const llm = o.llm ?? createClaudeJson();
  const usage = newUsage();
  let modelErrors = 0;
  const voice = loadVoice(voicePath(o.account, o.dataDir));
  const live = o.mode === 'drafts' && !o.dryRun;
  let hygiene = structuredClone(st.hygiene);
  const state: MailState = {
    get: async () => hygiene,
    put: async (n) => { hygiene = n; if (!o.dryRun) writeState(sPath, { ...st, hygiene }); },
  };
  const moves = await approvedMoves(o.ctx, hygiene);
  const lookback = new Date(now.getTime() - (o.sinceDays ?? DEFAULT_SINCE_DAYS) * 86400_000).toISOString();
  // The owner answers from Outlook, so replies land in Sent Items: read them first, close their asks, and mark those threads answered. @req FR:email-runner/graph.replies
  const sent = await createGraphMail({ transport: o.transport, folder: 'sentitems', ...(st.sentCursor ? {} : { since: lookback }) }).delta(st.sentCursor);
  const answered = new Map<string, string>();
  for (const m of sent.messages) if (!answered.has(m.conversationId) || answered.get(m.conversationId)! < m.receivedAt) answered.set(m.conversationId, m.receivedAt);
  let resolved = 0;
  if (!o.dryRun) for (const conv of answered.keys()) if (await resolveAsk(o.ctx, { conversationId: conv } as Message)) resolved++;
  const inbox = createGraphMail({ transport: o.transport, ...(st.cursor ? {} : { since: lookback }) });
  const marked: MailProvider = { ...inbox, async delta(c) { const r = await inbox.delta(c); return { ...r, messages: r.messages.map((m) => (answered.has(m.conversationId) && answered.get(m.conversationId)! >= m.receivedAt ? { ...m, threadLastFrom: o.account } : m)) }; } };
  const provider = withDetails(marked, (id) => messageDetails({ transport: o.transport }, id), o.max ?? DEFAULT_MAX);
  const classifier = tolerant(createClassifier(llm, usage), () => { modelErrors++; });
  const { cursor, summary, results } = await runTriage({
    ctx: o.ctx, provider, rules: o.rules ?? rulesFor(o.account, o.dataDir), project: o.project, cursor: st.cursor, voice,
    classifier, beforeAsks: () => classifier.check(),
    ...(live ? { drafter: createDrafter(llm, voice, usage) } : {}),
    hygiene: { state, judge: createJudge(llm, usage), ...(live ? { actions: createGraphActions({ transport: o.transport, approvedMoves: moves }), ...(o.http ? { http: o.http } : {}) } : {}) },
  });
  const lastSummary: PassSummary = { ...summary, resolved: summary.resolved + resolved, modelCalls: usage.calls, costUsd: Math.round(usage.costUsd * 10000) / 10000, modelErrors };
  if (!o.dryRun) await o.onResults?.(results);
  if (!o.dryRun) writeState(sPath, { version: 1, cursor, sentCursor: sent.cursor, hygiene, lastRun: now.toISOString(), lastSummary });
  return lastSummary;
}
