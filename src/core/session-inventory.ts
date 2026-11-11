/**
 * Session inventory: reads the Claude app session store (read-only), classifies each session, and ranks one Needs-you list.
 * Facts are cached by mtime in ~/.stack/sessions.json (live state, never git). No LLM call; no transcript text leaves the reader.
 * @req FR:session-inventory/$session
 */
import { closeSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { writeAtomic } from './file-lock';

export const SESSION_STATES = ['running', 'waiting', 'stuck', 'done', 'pinned', 'idle'] as const;
export type SessionState = (typeof SESSION_STATES)[number];
export const SESSION_REASONS = ['question', 'permission', 'needs-user', 'blocked', 'error', 'cut-short', 'api-error', 'dead-turn', 'pr-merged', 'superseded', 'turn-open', 'idle'] as const;
export type SessionReason = (typeof SESSION_REASONS)[number];
export const PROJECTS = ['allyte', 'ftk', 'focus', 'f4', 'xerilium', 'other'] as const;
export type SessionProject = (typeof PROJECTS)[number];
export type TailKind = 'turn-end' | 'question' | 'tool' | 'tool-result' | 'user' | 'assistant-text' | 'api-error' | 'none';

/** What Stack keeps from one session file and its transcript tail. No transcript text. */
export interface SessionFacts {
  id: string; title: string; cwd: string; archived: boolean; pinned: boolean;
  createdAt?: number; lastActivityAt: number; lastTurnEdgeAt?: number; permissionMode?: string;
  scheduledTaskId?: string; errorAt?: number; cutShort?: boolean; awaitingPerson?: boolean; wrapUpNeedsUser?: boolean;
  /** The app's post-turn summary, only when it summarizes the latest assistant turn. */
  summary?: { category: string; ask?: string };
  prs: { url: string; state: string; dismissed?: boolean }[];
  tail?: TailKind; txMtimeMs?: number;
  /** Latest subagent transcript write while a tool call is pending (an Agent call writes there, not to the main transcript). */
  subMtimeMs?: number;
}

/** One session as Stack shows it. @req FR:session-inventory/needs.item */
export interface SessionItem {
  id: string; title: string; project: SessionProject; state: SessionState; reason: SessionReason; pinned: boolean;
  lastActivityAt: string; link: string; prs: { url: string; state: string }[]; ask?: string; scheduled?: { id: string; name: string };
}
export interface Inventory {
  at: string; total: number; counts: Record<SessionState, number>;
  needsYou: SessionItem[]; archive: SessionItem[]; sessions: SessionItem[];
}
export interface InventoryOptions { sessionsDir?: string; projectsDir?: string; home: string; now?: () => Date }

const MIN = 60_000;
const PROMPT_MS = 5 * MIN;
const DEAD_MS = 30 * MIN;
const TAIL_BYTES = 64 * 1024;
const QUESTION_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);

/** The app session store; `STACK_SESSIONS_DIR` overrides it. @req FR:session-inventory/read.files */
export const defaultSessionsDir = (env: NodeJS.ProcessEnv = process.env, home = homedir()): string => env.STACK_SESSIONS_DIR || join(home, 'Library/Application Support/Claude/claude-code-sessions');
/** The CLI transcripts; `STACK_TRANSCRIPTS_DIR` overrides it. @req FR:session-inventory/read.tail */
export const defaultProjectsDir = (env: NodeJS.ProcessEnv = process.env, home = homedir()): string => env.STACK_TRANSCRIPTS_DIR || join(home, '.claude/projects');
export const sessionLink = (id: string): string => `claude://claude.ai/epitaxy/${id}`;

const RULES: [RegExp, SessionProject][] = [
  [/^(finops-hubs|allyte)/i, 'allyte'], [/^finops-toolkit/i, 'ftk'], [/^focus/i, 'focus'], [/^f4/i, 'f4'],
  [/^(todo|stack|catalyst|printer|prime|pr-sweep)/i, 'xerilium'],
];
/**
 * The project of a session from the first folder under `dev/`.
 * @req FR:session-inventory/needs.project
 */
export function projectOf(cwd: string): SessionProject {
  const m = /\/dev\/([^/]+)/.exec(cwd);
  if (!m) return 'other';
  return RULES.find(([re]) => re.test(m[1]))?.[1] ?? 'other';
}

const TAIL_MAX = 4 * 1024 * 1024;
const INTERRUPTED = /^\[Request interrupted by user/;
const LOCAL = /^<(command-name|local-command-|bash-input|bash-stdout|bash-stderr)/;

/** The kind of one transcript line, or undefined when it is not a main-chain turn event. */
function eventKind(l: string): TailKind | undefined {
  let e: { type?: string; subtype?: string; isSidechain?: boolean; isMeta?: boolean; isCompactSummary?: boolean; isVisibleInTranscriptOnly?: boolean; isApiErrorMessage?: boolean; message?: { content?: unknown } };
  try { e = JSON.parse(l); } catch { return undefined; }
  if (!e || typeof e !== 'object' || e.isSidechain || e.isMeta || e.isCompactSummary || e.isVisibleInTranscriptOnly) return undefined;
  if (e.type === 'system') return e.subtype === 'stop_hook_summary' || e.subtype === 'turn_duration' ? 'turn-end' : e.subtype === 'api_error' ? 'api-error' : undefined;
  const c = e.message?.content;
  if (e.type === 'user') {
    if (Array.isArray(c) && c.some((x) => (x as { type?: string })?.type === 'tool_result')) return 'tool-result';
    // The owner stopped the turn: it is closed, not dead.
    const first = typeof c === 'string' ? c : Array.isArray(c) ? (c[0] as { text?: unknown })?.text : undefined;
    // A local slash command or `!` shell line runs no model turn.
    return typeof first === 'string' && (INTERRUPTED.test(first) || LOCAL.test(first)) ? 'turn-end' : 'user';
  }
  // A turn that failed on an API error ends with an assistant line marked as such.
  if (e.type === 'assistant' && e.isApiErrorMessage) return 'api-error';
  if (e.type === 'assistant') {
    const last = Array.isArray(c) ? (c.at(-1) as { type?: string; name?: string } | undefined) : undefined;
    if (last?.type === 'tool_use') return QUESTION_TOOLS.has(String(last.name)) ? 'question' : 'tool';
    return 'assistant-text';
  }
  return undefined;
}

/**
 * The kind of the last main-chain event in the transcript tail; undefined when there is no transcript. Reads the last 64 KiB,
 * and more (up to 4 MiB) only when no whole event fits. @req FR:session-inventory/read.tail
 */
export function readTail(file: string): TailKind | undefined {
  let fd: number;
  try { fd = openSync(file, 'r'); } catch { return undefined; }
  try {
    const size = fstatSync(fd).size;
    for (let want = TAIL_BYTES; ; want *= 4) {
      const n = Math.min(size, want, TAIL_MAX);
      const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, size - n);
      const lines = buf.toString('utf8').split('\n');
      // The first line is cut unless the window starts at the file start.
      for (let i = lines.length - 1; i >= (n < size ? 1 : 0); i--) { const k = eventKind(lines[i]); if (k) return k; }
      if (n >= size || n >= TAIL_MAX) return 'none';
    }
  } catch { return undefined; } finally { closeSync(fd); }
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
/** One line, at most `max` characters. */
const line = (v: unknown, max: number): string | undefined => {
  const t = str(v)?.replace(new RegExp("[\\p{Cc}\\u2028\\u2029]+", "gu"), " ").replace(/\s+/g, " ").trim();
  return t ? (t.length > max ? `${t.slice(0, max - 1)}\u2026` : t) : undefined;
};

/** The facts of one session file, or null when it is not a session. @req FR:session-inventory/read.bad */
export function sessionFacts(raw: unknown): Omit<SessionFacts, 'tail' | 'txMtimeMs'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const j = raw as Record<string, unknown>;
  const id = str(j.sessionId); const cwd = str(j.cwd) ?? '';
  if (!id) return null;
  const pts = j.postTurnSummary as Record<string, unknown> | undefined;
  const current = pts && typeof pts === 'object' && str(pts.summarizes_uuid) && pts.summarizes_uuid === j.lastAssistantUuid;
  const wrap = j.turnWrapUp as Record<string, unknown> | undefined;
  const prs = (Array.isArray(j.prs) ? j.prs : []).flatMap((p) => {
    const o = p as Record<string, unknown>;
    return o && str(o.url) && str(o.state) ? [{ url: o.url as string, state: o.state as string, ...(o.dismissed === true ? { dismissed: true } : {}) }] : [];
  });
  const errorAt = str(j.error) ? num(j.errorAt) ?? num(j.lastActivityAt) : undefined;
  return {
    id, title: line(j.title, 200) ?? id, cwd, archived: j.isArchived === true, pinned: j.isStarred === true,
    lastActivityAt: num(j.lastActivityAt) ?? num(j.createdAt) ?? 0, prs,
    ...(num(j.createdAt) !== undefined ? { createdAt: num(j.createdAt) } : {}),
    ...(num(j.lastTurnEdgeAt) !== undefined ? { lastTurnEdgeAt: num(j.lastTurnEdgeAt) } : {}),
    ...(str(j.permissionMode) ? { permissionMode: str(j.permissionMode) } : {}),
    ...(str(j.scheduledTaskId) ? { scheduledTaskId: str(j.scheduledTaskId) } : {}),
    ...(errorAt !== undefined ? { errorAt } : {}),
    ...(j.lastTurnCutShort === true ? { cutShort: true } : {}),
    ...(j.interruptedAwaitingPerson === true ? { awaitingPerson: true } : {}),
    ...(wrap && typeof wrap === 'object' && str(wrap.needsUser) ? { wrapUpNeedsUser: true } : {}),
    ...(current ? { summary: { category: str(pts!.status_category) ?? '', ...(line(pts!.needs_action, 200) ? { ask: line(pts!.needs_action, 200) } : {}) } } : {}),
  };
}

/**
 * The state of one session at `now`, and the rule that set it.
 * @req FR:session-inventory/state.waiting @req FR:session-inventory/state.stuck @req FR:session-inventory/state.running
 * @req FR:session-inventory/state.done @req FR:session-inventory/state.pinned @req FR:session-inventory/state.idle @req FR:session-inventory/state.activity
 */
export function classify(f: SessionFacts, now: number): { state: SessionState; reason: SessionReason } {
  const activity = Math.max(f.lastActivityAt, f.txMtimeMs ?? 0, f.subMtimeMs ?? 0);
  const quiet = now - activity;
  const open = f.tail ? f.tail === 'tool' || f.tail === 'tool-result' || f.tail === 'user' : f.lastActivityAt > (f.lastTurnEdgeAt ?? 0) + 1000;
  const scheduled = !!f.scheduledTaskId;
  if (f.tail === 'question') return { state: 'waiting', reason: 'question' };
  if (f.awaitingPerson || f.wrapUpNeedsUser) return { state: 'waiting', reason: 'needs-user' };
  if (!open && f.summary?.category === 'blocked') return { state: 'waiting', reason: 'blocked' };
  if (f.tail === 'tool' && quiet >= PROMPT_MS && !scheduled && f.permissionMode !== 'bypassPermissions') return { state: 'waiting', reason: 'permission' };
  if (f.errorAt !== undefined && f.errorAt > (f.lastTurnEdgeAt ?? 0)) return { state: 'stuck', reason: 'error' };
  // A turn the owner interrupted ends at turn-end: it is closed, not stuck.
  if (f.cutShort && f.tail !== 'turn-end') return { state: 'stuck', reason: 'cut-short' };
  // A fresh API error may still be retrying.
  if (f.tail === 'api-error' && quiet >= PROMPT_MS) return { state: 'stuck', reason: 'api-error' };
  if (open && (quiet >= DEAD_MS || (scheduled && f.tail === 'tool' && quiet >= PROMPT_MS))) return { state: 'stuck', reason: 'dead-turn' };
  if (open) return { state: 'running', reason: 'turn-open' };
  const live = f.prs.filter((p) => !p.dismissed);
  if (!f.pinned && live.some((p) => p.state === 'MERGED') && live.every((p) => p.state === 'MERGED' || p.state === 'CLOSED')) return { state: 'done', reason: 'pr-merged' };
  return { state: f.pinned ? 'pinned' : 'idle', reason: 'idle' };
}

interface CacheEntry { mtimeMs: number; size: number; tx?: string; txMtimeMs?: number; facts: SessionFacts | null }
interface SessionsFile { version: 1; at: string; projectsDir: string; cache: Record<string, CacheEntry>; inventory: Inventory }

const listDirs = (d: string): string[] => { try { return readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(d, e.name)); } catch { return []; } };
/** The newest file mtime in a folder, or undefined. */
const latestMtime = (d: string): number | undefined => { let m: number | undefined; try { for (const n of readdirSync(d)) { const t = statOf(join(d, n))?.mtimeMs; if (t !== undefined && (m === undefined || t > m)) m = t; } } catch { /* none */ } return m; };
const statOf = (f: string) => { try { const s = statSync(f); return { mtimeMs: s.mtimeMs, size: s.size }; } catch { return undefined; } };

/** Scheduled task names by id from every `scheduled-tasks.json`. */
function scheduledNames(folders: string[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const d of folders) {
    try {
      const j = JSON.parse(readFileSync(join(d, 'scheduled-tasks.json'), 'utf8')) as { scheduledTasks?: { id?: unknown; displayName?: unknown }[] };
      for (const t of Array.isArray(j.scheduledTasks) ? j.scheduledTasks : []) if (typeof t?.id === 'string') names.set(t.id, line(t.displayName, 200) ?? t.id);
    } catch { /* none here */ }
  }
  return names;
}

/**
 * Reads the session store (read-only), classifies each session, ranks Needs you, and lists archive candidates.
 * Writes `<home>/sessions.json` (best effort). @req FR:session-inventory/read.files @req FR:session-inventory/read.cache
 * @req FR:session-inventory/needs.list @req FR:session-inventory/needs.rank @req FR:session-inventory/archive.list
 * @req FR:session-inventory/archive.superseded @req FR:session-inventory/store.result @req FR:session-inventory/store.write
 */
export function runInventory(o: InventoryOptions): Inventory {
  const now = (o.now ?? (() => new Date()))();
  const T = now.getTime();
  const sessionsDir = o.sessionsDir ?? defaultSessionsDir();
  const projectsDir = o.projectsDir ?? defaultProjectsDir();
  const cacheFile = join(o.home, 'sessions.json');
  let old: Record<string, CacheEntry> = {};
  // Another version or transcripts folder means cached paths and facts may not fit: start cold.
  try { const j = JSON.parse(readFileSync(cacheFile, 'utf8')) as Partial<SessionsFile>; if (j.version === 1 && j.projectsDir === projectsDir && j.cache && typeof j.cache === 'object') old = j.cache; } catch { /* cold cache */ }
  // Read-only: only stat, readdir and read on the app store. @req FR:session-inventory/read.files
  const folders = listDirs(sessionsDir).flatMap(listDirs);
  const cache: Record<string, CacheEntry> = {};
  for (const d of folders) {
    let names: string[];
    try { names = readdirSync(d).filter((n) => n.startsWith('local_') && n.endsWith('.json')); } catch { continue; }
    for (const n of names) {
      const path = join(d, n);
      const st = statOf(path);
      if (!st) continue;
      const prev = old[path];
      let entry: CacheEntry;
      // A file whose stats did not change is not read again; one warm run reads no session file. @req FR:session-inventory/read.cache @req FR:session-inventory/read.fast
      if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) entry = prev;
      else {
        let raw: unknown;
        try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch { raw = null; }
        const facts = sessionFacts(raw);
        const cli = (raw as { cliSessionId?: unknown } | null)?.cliSessionId;
        entry = { ...st, facts, ...(facts && typeof cli === 'string' ? { tx: join(projectsDir, facts.cwd.replace(/[^A-Za-z0-9]/g, '-'), `${cli}.jsonl`) } : {}) };
      }
      // The transcript tail is read again only when its mtime moves; archived sessions skip it.
      if (entry.facts && !entry.facts.archived && entry.tx) {
        const tx = statOf(entry.tx);
        if (!tx) { const rest = { ...entry.facts }; delete rest.tail; delete rest.txMtimeMs; entry = { ...entry, facts: rest, txMtimeMs: undefined }; }
        else if (tx.mtimeMs !== entry.txMtimeMs || entry.facts.tail === undefined) {
          const tail = readTail(entry.tx);
          // A failed read keeps no transcript time, so the next run reads the tail again.
          entry = tail ? { ...entry, txMtimeMs: tx.mtimeMs, facts: { ...entry.facts, tail, txMtimeMs: tx.mtimeMs } } : { ...entry, txMtimeMs: undefined };
        }
      }
      // A pending tool call may be a subagent that writes only its own transcript: its writes count as activity (not cached).
      if (entry.facts) {
        const facts: SessionFacts = { ...entry.facts }; delete facts.subMtimeMs;
        const sub = facts.tail === 'tool' && entry.tx ? latestMtime(join(entry.tx.replace(/\.jsonl$/, ''), 'subagents')) : undefined;
        entry = { ...entry, facts: sub ? { ...facts, subMtimeMs: sub } : facts };
      }
      cache[path] = entry;
    }
  }

  const sched = scheduledNames(folders);
  // @req FR:session-inventory/state.archived
  const facts = Object.values(cache).map((e) => e.facts).filter((f): f is SessionFacts => !!f && !f.archived);
  const latestRun = new Map<string, number>();
  // An archived newer run still supersedes older runs.
  for (const f of Object.values(cache).map((e) => e.facts)) if (f?.scheduledTaskId) latestRun.set(f.scheduledTaskId, Math.max(latestRun.get(f.scheduledTaskId) ?? -Infinity, f.createdAt ?? f.lastActivityAt));
  const counts = Object.fromEntries(SESSION_STATES.map((s) => [s, 0])) as Record<SessionState, number>;
  const items: (SessionItem & { at: number; superseded: boolean })[] = facts.map((f) => {
    const { state, reason } = classify(f, T);
    counts[state]++;
    const superseded = !!f.scheduledTaskId && (f.createdAt ?? f.lastActivityAt) < latestRun.get(f.scheduledTaskId)! && !f.pinned && state !== 'running';
    const at = Math.max(f.lastActivityAt, f.txMtimeMs ?? 0, f.subMtimeMs ?? 0);
    return {
      // @req FR:session-inventory/needs.reason
      id: f.id, title: f.title, project: projectOf(f.cwd), state, reason: superseded ? 'superseded' : reason, pinned: f.pinned,
      lastActivityAt: new Date(at).toISOString(), link: sessionLink(f.id), prs: f.prs.filter((p) => !p.dismissed).map((p) => ({ url: p.url, state: p.state })),
      ...(f.summary?.ask && (state === 'waiting' || state === 'stuck') ? { ask: f.summary.ask } : {}),
      ...(f.scheduledTaskId ? { scheduled: { id: f.scheduledTaskId, name: sched.get(f.scheduledTaskId) ?? f.scheduledTaskId } } : {}),
      at, superseded,
    };
  }).sort((a, b) => b.at - a.at);
  const strip = (x: (typeof items)[number]): SessionItem => { const i: Partial<typeof x> = { ...x }; delete i.at; delete i.superseded; return i as SessionItem; };
  const rank = (p: SessionProject) => PROJECTS.indexOf(p);
  const needsYou = items.filter((i) => (i.state === 'waiting' || i.state === 'stuck') && !i.superseded)
    .sort((a, b) => rank(a.project) - rank(b.project) || (a.state === b.state ? 0 : a.state === 'waiting' ? -1 : 1) || b.at - a.at).map(strip);
  const archive = items.filter((i) => i.state === 'done' || i.superseded).map(strip);
  const inventory: Inventory = { at: now.toISOString(), total: items.length, counts, needsYou, archive, sessions: items.map(strip) };
  try {
    mkdirSync(o.home, { recursive: true, mode: 0o700 });
    writeAtomic(cacheFile, `${JSON.stringify({ version: 1, at: inventory.at, projectsDir, cache, inventory } satisfies SessionsFile)}\n`);
  } catch { /* the cache is best effort: a failed write never fails the inventory */ }
  return inventory;
}
