/**
 * Inbox source status: what is connected, when it last synced, and the exact human step when it is not working.
 * Pure (no file system): the local probe and the sync records come in as data. Codes and times only; never a token or message text.
 * @req FR:inbox-page/src.shape @req FR:inbox-page/src.record @req FR:inbox-page/src.state @req FR:inbox-page/src.fresh @req FR:inbox-page/src.planned
 * @req FR:inbox-page/src.multi @req FR:inbox-page/src.summary @req FR:inbox-page/src.help @req FR:inbox-page/src.safe
 */
import { MAILBOX } from '../core/config';
import { ConflictError, type AuxFiles, type Storage } from '../core/storage';

export { MAILBOX };
import type { Source } from './types';

export const SOURCE_STATES = ['not-connected', 'connecting', 'ok', 'error', 'stale'] as const;
export type SourceState = (typeof SOURCE_STATES)[number];
/** What went wrong, as a code. A record never holds raw error text. */
export const SYNC_ERRORS = ['signin-expired', 'model-down', 'sync-failed'] as const;
export type SyncError = (typeof SYNC_ERRORS)[number];
export type MailMode = 'read-only' | 'drafts';

/** @req FR:inbox-page/src.shape */
export interface InboxSource {
  kind: Source;
  /** Mailbox address for email; empty for a source with one account or none known yet. */
  account: string;
  state: SourceState;
  lastSyncAt?: string;
  /** One line the owner reads: what is wrong. */
  error?: string;
  /** One sentence: the exact human step. */
  needs?: string;
  /** The terminal command for that step, when one exists. */
  command?: string;
  doc?: string;
  /** Email only. */
  mode?: MailMode;
  /** No connector ships yet: shown, never counted. @req FR:inbox-page/src.planned */
  planned?: boolean;
}

/** One connector run, written by the runner to the data repo. @req FR:inbox-page/src.record */
export interface SyncRecord { kind: Source; account: string; at: string; ok: boolean; error?: SyncError; /** Email only: the sign-in mode, so a fix keeps drafts on a host with no probe. */ mode?: MailMode }

/** What a local host sees on this machine. No token values. @req FR:inbox-page/src.probe */
export interface SourceProbe {
  emails: { account: string; mode: MailMode; error?: 'token-unreadable' }[];
  github: boolean;
  /** The app registration id of an existing Graph sign-in (not a secret), for the sign-in command. */
  clientId?: string;
}

/** @req FR:inbox-page/src.summary */
export interface SourcesSummary { connected: number; total: number; fresh: number; attention: boolean; canClaimZero: boolean; headline: string | null }

export const DEFAULT_FRESH_MINUTES = 30;
export const SOURCES_PATH = '.stack/inbox-sources.json';
const DOC = 'https://github.com/Xerilium/stack/blob/main/docs/inbox-sources.md';
const KINDS: Source[] = ['email', 'github', 'teams', 'slack'];
const LABEL: Record<Source, string> = { email: 'Email', github: 'GitHub', teams: 'Teams', slack: 'Slack' };
const NEVER_SENDS = 'Stack never sends.';

// ------------------------------------------------------------------ records

const isTime = (s: unknown): s is string => typeof s === 'string' && s.length <= 40 && !Number.isNaN(Date.parse(s));
const acct = (s: unknown) => (typeof s === 'string' ? s.trim().toLowerCase().slice(0, 200) : '');
/** Email needs a mailbox address; every other kind has one account, named by an empty string. */
const accountOk = (kind: Source, a: string) => (kind === 'email' ? MAILBOX.test(a) : a === '');
const same = (a: SyncRecord, b: SyncRecord) => a.kind === b.kind && a.account === b.account;

/** Well formed records only; an unknown error becomes `sync-failed`, so stray text never shows. @req FR:inbox-page/src.safe */
export function parseRecords(raw: unknown): SyncRecord[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { records?: unknown }).records) ? (raw as { records: unknown[] }).records : [];
  const out: SyncRecord[] = [];
  for (const r of list as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object' || !KINDS.includes(r.kind as Source) || !isTime(r.at) || typeof r.ok !== 'boolean') continue;
    const rec: SyncRecord = { kind: r.kind as Source, account: acct(r.account), at: r.at, ok: r.ok };
    if (!accountOk(rec.kind, rec.account)) continue;
    if (rec.kind === 'email' && (r.mode === 'read-only' || r.mode === 'drafts')) rec.mode = r.mode;
    if (!r.ok) rec.error = SYNC_ERRORS.includes(r.error as SyncError) ? (r.error as SyncError) : 'sync-failed';
    const i = out.findIndex((x) => same(x, rec));
    if (i >= 0) out[i] = rec; else out.push(rec);
  }
  return out;
}

const aux = (s: Storage): AuxFiles | null => (typeof (s as Partial<AuxFiles>).readAux === 'function' && typeof (s as Partial<AuxFiles>).writeAux === 'function' ? (s as unknown as AuxFiles) : null);

/** A host without aux files, a missing file or a bad file reads as no records. */
export async function readRecords(st: Storage): Promise<SyncRecord[]> {
  const a = aux(st);
  const f = a ? await a.readAux(SOURCES_PATH).catch(() => null) : null;
  if (!f) return [];
  try { return parseRecords(JSON.parse(f.content)); } catch { return []; }
}

/** Writes one record; it replaces the older one for the same kind and account. A version conflict retries up to 3 times. @req FR:inbox-page/src.record */
export async function recordSync(st: Storage, rec: SyncRecord): Promise<void> {
  const a = aux(st);
  if (!a) return;
  const clean = parseRecords({ records: [rec] })[0];
  if (!clean) throw new Error('Invalid sync record');
  for (let i = 0; ; i++) {
    const f = await a.readAux(SOURCES_PATH).catch(() => null);
    let cur: SyncRecord[] = [];
    try { cur = f ? parseRecords(JSON.parse(f.content)) : []; } catch { cur = []; }
    const j = cur.findIndex((x) => same(x, clean));
    if (j >= 0) cur[j] = clean; else cur.push(clean);
    try { await a.writeAux(SOURCES_PATH, `${JSON.stringify({ version: 1, records: cur }, null, 2)}\n`, { expectedVersion: f?.version ?? null }); return; } catch (e) { if (!(e instanceof ConflictError) || i >= 2) throw e; }
  }
}

// ------------------------------------------------------------------ state

/** `3h ago`, `5m ago`, `2d ago`, `just now`. */
export function agoText(at: string, now: Date): string {
  const m = Math.max(0, Math.round((now.getTime() - Date.parse(at)) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

const ERROR_TEXT: Record<SyncError | 'token-unreadable', (s: Pick<InboxSource, 'kind' | 'account'>) => string> = {
  'signin-expired': (s) => `${LABEL[s.kind]} sign-in expired${s.account ? `: ${s.account}` : ''}`,
  'model-down': () => 'Claude is not answering, so triage stopped',
  'sync-failed': (s) => `${LABEL[s.kind]} sync failed${s.account ? `: ${s.account}` : ''}`,
  'token-unreadable': (s) => `${LABEL[s.kind]} sign-in file cannot be read${s.account ? `: ${s.account}` : ''}`,
};

/** The sign-in command. The client id comes from an existing sign-in; `--with mail` is read-only. @req FR:inbox-page/src.help */
const loginCmd = (account: string, clientId: string | undefined, mode: MailMode | undefined) =>
  `stack graph login --client-id ${clientId ?? '<app id>'} --account ${account || '<address>'} --with ${mode === 'drafts' ? 'mail,drafts' : 'mail'}`;
const SIGN_IN_NEEDS = `Sign in from a terminal. Read-only by default: Stack reads mail. Use --with mail,drafts to let Stack write reply drafts. ${NEVER_SENDS}`;

/** Fills `needs`, `command` and `doc` for a source that is not ok. @req FR:inbox-page/src.help */
function help(s: InboxSource, code: SyncError | 'token-unreadable' | undefined, clientId: string | undefined): InboxSource {
  if (s.kind === 'email') {
    const doc = `${DOC}#email`;
    if (s.state === 'not-connected' || code === 'signin-expired') return { ...s, needs: SIGN_IN_NEEDS, command: loginCmd(s.account, clientId, s.mode), doc };
    if (code === 'token-unreadable') return { ...s, needs: `Stack cannot read the sign-in file graph-token-${s.account}.json in ~/.config/stack. If it is readable by others, run chmod 600 on it. Else sign in again. ${NEVER_SENDS}`, command: loginCmd(s.account, clientId, s.mode), doc };
    if (code === 'model-down') return { ...s, needs: `Run claude in a terminal and sign in. Triage starts again on the next pass. ${NEVER_SENDS}`, command: 'claude', doc };
    if (code === 'sync-failed') return { ...s, needs: 'Run one pass by hand to see the error.', command: `stack email run --account ${s.account}`, doc };
    if (s.state === 'connecting') return { ...s, needs: `Signed in. Run the first sync, then schedule it with stack email schedule. ${NEVER_SENDS}`, command: `stack email run --account ${s.account}`, doc };
    if (s.state === 'stale') return { ...s, needs: 'Sync is behind. Run every mailbox now and check the schedule (stack email schedule).', command: 'stack email run --all', doc };
    return s;
  }
  if (s.kind === 'github') {
    const doc = `${DOC}#github`;
    if (s.state === 'not-connected') return { ...s, needs: 'Sign in to the GitHub CLI, or set GITHUB_TOKEN for the Stack host. Read only: Stack never posts.', command: 'gh auth login', doc };
    if (s.state === 'connecting') return { ...s, needs: 'GitHub is signed in. The GitHub inbox sync is not scheduled yet, so GitHub items do not show here.', doc };
    if (s.state === 'error' || s.state === 'stale') return { ...s, needs: 'Check the GitHub CLI sign-in.', command: 'gh auth status', doc };
    return s;
  }
  if (s.kind === 'teams') return { ...s, needs: 'Needs a work or school account and delegated Chat.Read on the Stack app registration. The Teams connector is not wired yet. Read only.', doc: `${DOC}#teams` };
  return { ...s, needs: 'Needs a Slack app with a user token (xoxp-) and read scopes (im, mpim, channels, groups: read and history). The Slack connector is not wired yet. Read only.', doc: `${DOC}#slack` };
}

/** One source from its latest record (if any), given it is known to exist. @req FR:inbox-page/src.state */
function fromRecord(base: InboxSource, rec: SyncRecord | undefined, now: Date, freshMs: number, clientId?: string): InboxSource {
  if (rec?.mode && !base.mode) base = { ...base, mode: rec.mode };
  if (!rec) return help({ ...base, state: base.state === 'not-connected' ? 'not-connected' : 'connecting' }, undefined, clientId);
  const s: InboxSource = { ...base, lastSyncAt: rec.at, state: !rec.ok ? 'error' : now.getTime() - Date.parse(rec.at) <= freshMs ? 'ok' : 'stale' };
  if (!rec.ok) s.error = ERROR_TEXT[rec.error ?? 'sync-failed'](s);
  return help(s, rec.ok ? undefined : rec.error ?? 'sync-failed', clientId);
}

/**
 * Every inbox source with its real state. Email accounts come from the probe, the records and `accounts` (config).
 * @req FR:inbox-page/src.state @req FR:inbox-page/src.multi @req FR:inbox-page/src.planned
 */
export function buildSources(o: { now: Date; records: SyncRecord[]; probe?: SourceProbe; accounts?: string[]; freshMinutes?: number }): InboxSource[] {
  const freshMs = (o.freshMinutes && o.freshMinutes > 0 ? o.freshMinutes : DEFAULT_FRESH_MINUTES) * 60_000;
  const rec = (kind: Source, account: string) => o.records.find((r) => r.kind === kind && r.account === account);
  const clientId = o.probe?.clientId;
  const probed = new Map((o.probe?.emails ?? []).map((e) => [acct(e.account), e]));
  const accounts = [...new Set([...probed.keys(), ...o.records.filter((r) => r.kind === 'email').map((r) => r.account), ...(o.accounts ?? []).map(acct)].filter((a) => MAILBOX.test(a)))].sort();
  const out: InboxSource[] = [];
  for (const a of accounts) {
    const p = probed.get(a);
    const base: InboxSource = { kind: 'email', account: a, state: p ? 'connecting' : 'not-connected', ...(p ? { mode: p.mode } : {}) };
    if (p?.error) { out.push(help({ ...base, state: 'error', error: ERROR_TEXT['token-unreadable'](base) }, 'token-unreadable', clientId)); continue; }
    const r = rec('email', a);
    // Not signed in here, but a runner elsewhere reported it (the hosted app has no probe): trust the record.
    out.push(fromRecord(r && !p ? { ...base, state: 'connecting' } : base, r, o.now, freshMs, clientId));
  }
  if (!accounts.length) out.push(help({ kind: 'email', account: '', state: 'not-connected' }, undefined, clientId));
  const gh = rec('github', '');
  // GitHub counts once its runner has reported; until then it shows the sign-in only. @req FR:inbox-page/src.planned
  out.push(fromRecord({ kind: 'github', account: '', state: o.probe?.github || (!o.probe && gh) ? 'connecting' : 'not-connected', ...(gh ? {} : { planned: true }) }, o.probe && !o.probe.github ? undefined : gh, o.now, freshMs));
  out.push(help({ kind: 'teams', account: '', state: 'not-connected', planned: true }, undefined, clientId));
  out.push(help({ kind: 'slack', account: '', state: 'not-connected', planned: true }, undefined, clientId));
  return out;
}

/** Counts, the dot, and the one-line headline (first match wins). @req FR:inbox-page/src.summary */
export function summarize(sources: InboxSource[], now: Date): SourcesSummary {
  const counted = sources.filter((s) => !s.planned);
  const total = counted.length;
  const connected = counted.filter((s) => s.state === 'ok' || s.state === 'stale' || s.state === 'connecting').length;
  const fresh = counted.filter((s) => s.state === 'ok').length;
  const errors = counted.filter((s) => s.state === 'error');
  const stale = counted.filter((s) => s.state === 'stale');
  const attention = counted.some((s) => s.state === 'not-connected' || s.state === 'error');
  let headline: string | null = null;
  if (!connected && !errors.length) headline = 'No inboxes connected';
  else if (errors.length === 1) headline = errors[0].error ?? 'An inbox needs attention';
  else if (errors.length > 1) headline = `${errors.length} inboxes need attention`;
  else if (!fresh) {
    const newest = stale.map((s) => s.lastSyncAt!).sort().at(-1);
    headline = newest ? `Last synced ${agoText(newest, now)}` : 'Waiting for the first sync';
  } else if (stale.length) headline = `${fresh} of ${fresh + stale.length} inboxes up to date`;
  else if (fresh < connected) headline = `${fresh} of ${connected} inboxes synced; waiting for the first sync`;
  else if (connected < total) headline = `${connected} of ${total} sources connected`;
  // Zero is a claim about every inbox: one missing, broken, behind or unsynced source makes it untrue.
  return { connected, total, fresh, attention, canClaimZero: fresh >= 1 && fresh === total, headline };
}

/** Sources and summary from the stored records, the config and an optional probe (a failing probe reads as none). Shared by the API and the CLI. @req FR:inbox-page/api.sources @req FR:inbox-page/cli.sources */
export async function loadSources(o: { storage: Storage; now: Date; probe?: () => Promise<SourceProbe>; inbox?: { accounts?: string[]; freshMinutes?: number } }): Promise<{ sources: InboxSource[]; summary: SourcesSummary }> {
  const probe = o.probe ? await o.probe().catch(() => undefined) : undefined;
  const sources = buildSources({ now: o.now, records: await readRecords(o.storage), ...(probe ? { probe } : {}), ...(o.inbox?.accounts ? { accounts: o.inbox.accounts } : {}), ...(o.inbox?.freshMinutes ? { freshMinutes: o.inbox.freshMinutes } : {}) });
  return { sources, summary: summarize(sources, o.now) };
}
