/**
 * The PR board: pure rules that group the owner's open PRs and say who must act. No I/O.
 * Change the BLOCKED rule here only (`stateOf`); its tests list each case.
 * @req FR:pr-page/group.@function @req FR:pr-page/state.@function @req FR:pr-page/state.why @req FR:pr-page/card.action @req FR:pr-page/summary.@function
 */
import { PROJECTS, RULES, type SessionProject } from './session-inventory';
import { isSpecPath, needsLiveValidation } from './pr-review';

export const PR_GROUPS = ['processing', 'waiting', 'pending', 'paused'] as const;
export type PrGroup = (typeof PR_GROUPS)[number];
export type CiState = 'passing' | 'failing' | 'pending' | 'none';
export type Owner = 'me' | 'reviewer' | 'ci' | 'runner' | 'none';
export type Bucket = 'approve' | 'review' | 'decide' | 'unblock';

export interface PrCheck { name: string; state: 'pass' | 'fail' | 'pending' | 'action' | 'skip'; startedAt?: string; required?: boolean }
/** `id` is the thread's first review comment: GitHub takes replies to it only. */
export interface PrComment { author: string; body: string; url?: string; at?: string }
export interface PrThread { resolved: boolean; lastAuthor: string; lastBody: string; url?: string; id?: number; /** The GraphQL node id: resolve and unresolve take it. */ nodeId?: string; path?: string; /** The newest replies, oldest first; absent means only the last is known. */ comments?: PrComment[] }
export interface PrCommit { sha: string; title: string; url: string; at: string }
export interface PrFile { path: string; additions: number; deletions: number }
/** My pending (not submitted) review. */
export interface PrPendingReview { url: string; body: string; comments: { path: string; body: string }[] }
export type NextAction = 'validate' | 'signoff' | 'publish' | 'approve' | 'autopilot';
/** The live lane, as the board needs it. */
export interface LiveLane { url: string; state: string; serverUrl?: string; items: { text: string; state: string }[] }
export interface SignoffDetail { id: string; url: string; path?: string; ask: PrComment; after: PrComment[]; commits: PrCommit[] }
export type StepsDetail = { source: 'lane'; state: string; serverUrl?: string; items: { text: string; state: string }[] } | { source: 'body'; items: { text: string }[] };
/** @req FR:pr-page/detail.data */
export interface PrDetail { signoff?: SignoffDetail[]; review?: PrPendingReview; steps?: StepsDetail; notes?: { body: string; url: string; at?: string }[] }
/** @req FR:pr-page/summary.@function */
export interface PrSummary { live: string[]; signoff: string[]; autopilot: string[]; missing: { url: string; reason: string }[] }
/** What GitHub says about one open PR, normalized. */
export interface PrFacts {
  url: string; repo: string; number: number; title: string; author: string; draft: boolean;
  createdAt: string; updatedAt: string; headOid: string; headAt?: string; body: string;
  labels: string[]; assignees: string[]; requested: string[]; reviews: { author: string; state: string }[];
  mergeable: string; checks: PrCheck[];
  /** From the detail read; absent until it is read. */
  threads?: PrThread[]; comments?: PrComment[];
  commits?: PrCommit[]; files?: PrFile[]; pendingReview?: PrPendingReview;
}
export interface PrReport { state?: string; worker?: string; blocker?: string; nextAction?: string; owner: string; headSha?: string; ts?: string; link?: string; bucket?: Bucket }
export interface EscEntry { repo: string; number: number; url: string; title?: string; blocker?: string; context?: string; recommend?: string; link?: string; /** For the project chips. */ project?: SessionProject }
export interface Escalations { at?: string; blocked: EscEntry[]; enable: EscEntry[]; live: EscEntry[] }
export interface PrRec { id: string; agent: string; reason: string; toRank?: number }
export interface PrState { owner: Owner; login?: string; bucket?: Bucket; blocker: string; link: string; stalled: boolean; source: 'report' | 'rule'; key?: string; recommend?: string; replyTo?: number; /** The owner already answered this blocker (`stack pr-pri ack`). */ answered?: string }
/** @req FR:pr-page/$row */
export interface PrRow {
  url: string; repo: string; number: number; title: string; author: string; project: SessionProject; group: PrGroup; draft: boolean;
  createdAt: string; updatedAt: string; ci: CiState; unresolved: number; labels: string[]; state: PrState; bucket?: Bucket;
  healthy: boolean; agent: boolean; after: string[]; rank: number | null; pinned: boolean; rec?: PrRec; autopilot: boolean;
  mine: boolean; nextAction: NextAction | null; specLines: number | null; detail: PrDetail;
}
export interface BoardCtx {
  user: string; now: Date;
  /** Lowercase PR urls that an active agent links. */
  agentPrs: Set<string>;
  /** `owner` or `owner/repo` entries; undefined means repos the owner owns. */
  myRepos?: string[];
  exclude?: string[];
  reports?: Map<string, PrReport>;
  ranks?: Map<string, number>;
  recs?: Map<string, PrRec>;
  /** Owner thread acks by lowercase PR url. */
  acks?: Map<string, PrAck[]>;
  pinned?: Set<string>;
  /** The live lane (`stack live`). */
  live?: LiveLane;
  /** The first `liveValidation` url of the escalation set. */
  liveFirst?: string;
}

const HOUR = 3_600_000;
/** Label text without case, emoji, or variation selectors: `Status: 🤖 Autopilot` and `Status: Autopilot 🤖` are one label. */
const norm = (s: string) => s.replace(/[\p{Extended_Pictographic}\uFE0E\uFE0F\u200D]/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
export const LABELS = { autopilot: 'Status: 🤖 Autopilot', wip: 'Status: 🚧 WIP', paused: 'Status: ⏸️ Paused' } as const;
/** Labels match without case or emoji variation selectors. */
export const sameLabel = (a: string, b: string) => norm(a) === norm(b);
const has = (pr: PrFacts, label: string) => pr.labels.some((l) => sameLabel(l, label));
const needsAttention = (pr: PrFacts) => pr.labels.some((l) => /needs:?\s*attention/.test(norm(l)));
export const isAutopilot = (pr: PrFacts) => has(pr, LABELS.autopilot);
export const isWip = (pr: PrFacts) => has(pr, LABELS.wip);
export const same = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const isBot = (login: string) => /\[bot\]$/i.test(login);
/** A comment by the owner that no agent wrote (agents post as the owner with a prefix). @req FR:pr-page/group.@function */
const AGENT = /^\s*(🤖\uFE0F? \[AI\]|⚛\uFE0F? \[Catalyst\])/u;
export const isHuman = (author: string, body: string, user: string) => same(author, user) && !AGENT.test(body);
const firstLine = (s: string, n = 120) => { const l = (s.split('\n').find((x) => x.trim()) ?? '').trim().replace(/\s+/g, ' '); return l.length > n ? `${l.slice(0, n - 1).trimEnd()}…` : l; };

/** CI from the head commit's checks: any failure, then anything running, then none, else passing. */
export function ciOf(checks: PrCheck[]): CiState {
  const live = checks.filter((c) => c.state !== 'skip');
  if (live.length === 0) return 'none';
  if (live.some((c) => c.state === 'fail' || c.state === 'action')) return 'failing';
  if (live.some((c) => c.state === 'pending')) return 'pending';
  return 'passing';
}

/** @req FR:pr-page/state.bucket */
export function bucketOf(blocker: string): 'decide' | 'unblock' {
  return /\b(access|permissions?|approv(e|al|es)|secrets?|billing|deploy(s|ment)?|prod(uction)?|runner admin|admin (rights|access))\b/i.test(blocker) ? 'unblock' : 'decide';
}

/** A report owner word to an owner. @req FR:pr-page/state.report */
function reportOwner(o: string, user: string): { owner: Owner; login?: string } {
  const w = o.trim().toLowerCase();
  if (w === 'michael' || w === 'me' || same(w, user)) return { owner: 'me' };
  if (w === 'ci' || w === 'runner' || w === 'none' || w === '') return { owner: (w || 'none') as Owner };
  return { owner: 'reviewer', login: o.trim() };
}

/** Text without quoted (`>`) lines: a quote reply repeats the ask, it does not make one. */
const unquoted = (body: string) => body.split('\n').filter((l) => !/^\s*>/.test(l)).join('\n');
const unresolvedOf = (pr: PrFacts) => (pr.threads ?? []).filter((t) => !t.resolved);

/**
 * Who must act on one PR. The report wins when it matches the head; else the rule, first match wins.
 * Owner `me` only for Michael-only gates; waits on others, CI, and agent work never land in Blocked.
 * @req FR:pr-page/state.@function @req FR:pr-page/state.report @req FR:pr-page/state.rule @req FR:pr-page/state.bucket
 */
export function stateOf(pr: PrFacts, ctx: BoardCtx): PrState {
  const st = rawState(pr, ctx);
  // A rule gate the owner already answered waits on the agent now, not on him. @req FR:pr-page/state.rule
  if (st.owner !== 'me' || st.source !== 'rule') return st;
  const ack = ctx.acks?.get(pr.url.toLowerCase())?.find((a) => a.thread === st.link || (st.link === pr.url && a.thread === pr.url));
  return ack ? { owner: 'none', blocker: `Answered: ${firstLine(ack.note, 100)}`, link: st.link, stalled: false, source: 'rule', answered: ack.note } : st;
}
function rawState(pr: PrFacts, ctx: BoardCtx): PrState {
  const r = ctx.reports?.get(pr.url.toLowerCase());
  if (r && (!r.headSha || (pr.headOid.length >= 7 && (pr.headOid.startsWith(r.headSha) || r.headSha.startsWith(pr.headOid))))) {
    const o = reportOwner(r.owner, ctx.user);
    const blocker = firstLine(r.blocker || r.nextAction || '', 160);
    return { ...o, blocker, link: r.link ?? pr.url, stalled: false, source: 'report', ...(o.owner === 'me' ? { bucket: r.bucket ?? bucketOf(blocker) } : {}) };
  }
  const me = (blocker: string, link: string, bucket: Bucket, extra: Partial<PrState> = {}): PrState => ({ owner: 'me', bucket, blocker, link, stalled: false, source: 'rule', ...extra });
  // 1. Needs attention label.
  if (needsAttention(pr)) return me('Needs attention label', pr.url, 'decide', { key: 'needs-attention' });
  // 2. The newest 🧭 comment or thread reply with no later human comment.
  const comments = pr.comments ?? [];
  const asks = (body: string) => unquoted(body).includes('🧭');
  const lastCompass = comments.map((c, i) => ({ c, i })).filter(({ c }) => asks(c.body)).pop();
  if (lastCompass && !comments.slice(lastCompass.i + 1).some((c) => isHuman(c.author, c.body, ctx.user))) { const t = firstLine(lastCompass.c.body.replace(/^\s*(🤖\uFE0F? \[AI\]|⚛\uFE0F? \[Catalyst\])\s*/u, '')); return me(t, lastCompass.c.url ?? pr.url, bucketOf(t), { key: `c:${lastCompass.c.url ?? lastCompass.i}` }); }
  // In a thread, an agent note after the ask does not answer it; only a later human reply does.
  const openAsk = (t: PrThread): PrComment | undefined => {
    const list = t.comments?.length ? t.comments : [{ author: t.lastAuthor, body: t.lastBody, url: t.url }];
    const i = list.map((c) => asks(c.body)).lastIndexOf(true);
    return i >= 0 && !list.slice(i + 1).some((c) => isHuman(c.author, c.body, ctx.user)) ? list[i] : undefined;
  };
  const compassThread = unresolvedOf(pr).map((t) => ({ ...t, ask: openAsk(t) })).find((x) => x.ask);
  if (compassThread) { const t = firstLine(compassThread.ask!.body.replace(/^\s*(🤖\uFE0F? \[AI\]|⚛\uFE0F? \[Catalyst\])\s*/u, '')); return me(t, compassThread.ask!.url ?? compassThread.url ?? pr.url, bucketOf(t), { key: `t:${compassThread.id ?? compassThread.url}`, ...(compassThread.id ? { replyTo: compassThread.id } : {}) }); }
  // 3. An owner hold on an open thread.
  const hold = unresolvedOf(pr).find((t) => isHuman(t.lastAuthor, t.lastBody, ctx.user) && /\b(hold|wait for (my )?ack)\b/i.test(t.lastBody));
  if (hold) return me(`Sign-off: ${firstLine(hold.lastBody, 100)}`, hold.url ?? pr.url, 'decide', { key: `t:${hold.id ?? hold.url}`, ...(hold.id ? { replyTo: hold.id } : {}) });
  // 4. A workflow run that waits for a maintainer's approval.
  if (pr.checks.some((c) => c.state === 'action')) return me('Approve the workflow run', `${pr.url}/checks`, 'unblock', { key: 'action-required' });
  // 5. A human reviewer other than me.
  const changes = pr.reviews.find((v) => v.state === 'CHANGES_REQUESTED' && !same(v.author, ctx.user) && !isBot(v.author));
  const asked = pr.requested.find((l) => !same(l, ctx.user) && !isBot(l));
  const who = changes?.author ?? asked;
  if (who) return { owner: 'reviewer', login: who, blocker: `Waiting on ${who}`, link: pr.url, stalled: false, source: 'rule' };
  // 6. A check queued or running for over an hour: the runner.
  const now = ctx.now.getTime();
  const pending = pr.checks.filter((c) => c.state === 'pending');
  if (pending.some((c) => { const t = Date.parse(c.startedAt ?? pr.headAt ?? ''); return Number.isFinite(t) && now - t > HOUR; })) return { owner: 'runner', blocker: 'Checks queued over 1 h', link: `${pr.url}/checks`, stalled: false, source: 'rule' };
  // 7. Agent work: failing required check, conflict, or a thread that waits for a reply.
  const known = pr.checks.some((c) => c.required !== undefined);
  const failing = pr.checks.find((c) => c.state === 'fail' && (!known || c.required));
  const waiting = unresolvedOf(pr).find((t) => !same(t.lastAuthor, ctx.user));
  const signal = failing ? `Failing check ${failing.name}` : pr.mergeable === 'CONFLICTING' ? 'Merge conflict' : waiting ? 'Thread waits for a reply' : '';
  if (signal) {
    const link = failing ? `${pr.url}/checks` : pr.mergeable !== 'CONFLICTING' && waiting?.url ? waiting.url : pr.url;
    return ctx.agentPrs.has(pr.url.toLowerCase())
      ? { owner: 'none', blocker: `Agent on it: ${signal}`, link, stalled: false, source: 'rule' }
      : { owner: 'none', blocker: `No agent: ${signal}`, link, stalled: true, source: 'rule' };
  }
  // 8-9.
  if (pending.length) return { owner: 'ci', blocker: 'Checks running', link: `${pr.url}/checks`, stalled: false, source: 'rule' };
  return { owner: 'none', blocker: '', link: pr.url, stalled: false, source: 'rule' };
}

/** `owner/repo#n`, a PR url, or `#n` for any repo. @req FR:pr-page/group.@function */
export function excluded(pr: PrFacts, list: string[] = []): boolean {
  return list.some((e) => {
    const x = e.trim().toLowerCase();
    if (/^#?\d+$/.test(x)) return Number(x.replace('#', '')) === pr.number;
    return x === `${pr.repo.toLowerCase()}#${pr.number}` || x === pr.url.toLowerCase();
  });
}

const mine = (repo: string, user: string, list?: string[]) => {
  const owner = repo.slice(0, repo.indexOf('/'));
  if (!list?.length) return same(owner, user);
  return list.some((e) => same(e, repo) || same(e, owner));
};

/** One PR's group, or null when the board does not show it. @req FR:pr-page/group.@function */
export function groupOf(pr: PrFacts, ctx: BoardCtx): PrGroup | null {
  if (excluded(pr, ctx.exclude)) return null;
  const authored = same(pr.author, ctx.user);
  if (authored && has(pr, LABELS.paused)) return 'paused';
  if (isAutopilot(pr) && (authored || pr.assignees.some((a) => same(a, ctx.user)))) return 'processing';
  if (!authored && !pr.draft) {
    const mineLatest = pr.reviews.find((v) => same(v.author, ctx.user));
    const askedMe = pr.requested.some((l) => same(l, ctx.user));
    if (mineLatest?.state !== 'APPROVED' && (askedMe || mine(pr.repo, ctx.user, ctx.myRepos))) return 'waiting';
  }
  if (authored) return 'pending';
  return null;
}

const OWNER_PROJECT: [RegExp, SessionProject][] = [[/^allytehq$/i, 'allyte'], [/^xerilium$/i, 'xerilium'], [/^finops-open-cost-and-usage-spec$/i, 'focus']];
/** The project of a repo: the session-inventory rules on the name, then the owner. @req FR:pr-page/group.order */
export function projectOfRepo(repo: string): SessionProject {
  const [owner, name = ''] = repo.split('/');
  return RULES.find(([re]) => re.test(name))?.[1] ?? OWNER_PROJECT.find(([re]) => re.test(owner))?.[1] ?? 'other';
}
const FIRST = /^(finops-hubs|catalyst)/i;

/** Project order, FinOps hubs and Catalyst first in theirs, then queue rank, then oldest. @req FR:pr-page/group.order */
export function compareRows(a: PrRow, b: PrRow): number {
  const p = PROJECTS.indexOf(a.project) - PROJECTS.indexOf(b.project);
  if (p) return p;
  const f = Number(!FIRST.test(a.repo.split('/')[1] ?? '')) - Number(!FIRST.test(b.repo.split('/')[1] ?? ''));
  if (f) return f;
  const ra = a.rank ?? Infinity, rb = b.rank ?? Infinity;
  if (ra !== rb) return ra < rb ? -1 : 1;
  return Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.url.localeCompare(b.url);
}

/** `depends on #12`, `after o/r#3`, `blocked by #9`; at most 3. @req FR:pr-page/data.after */
export function afterOf(body: string, repo: string): string[] {
  const out: string[] = [];
  const re = /\b(?:depends on|after|blocked by)\s+((?:[\w.-]+\/[\w.-]+)?#\d+)/gi;
  for (const m of body.matchAll(re)) {
    const ref = m[1].startsWith('#') || m[1].toLowerCase().startsWith(`${repo.toLowerCase()}#`) ? `#${m[1].split('#')[1]}` : m[1];
    if (!out.includes(ref)) out.push(ref);
    if (out.length === 3) break;
  }
  return out;
}

/** Healthy Autopilot work: nobody but CI to wait on and not stalled. @req FR:pr-page/group.healthy */
export const isHealthy = (s: PrState) => (s.owner === 'none' || s.owner === 'ci') && !s.stalled;

/** @req FR:pr-page/group.bucket */
function rowBucket(group: PrGroup, pr: PrFacts, st: PrState): Bucket | undefined {
  if (st.owner === 'me') return st.bucket ?? 'decide';
  if (group === 'waiting') return 'approve';
  if (group === 'pending' && !pr.draft) return 'review';
  return undefined;
}

/** Active agents: running sessions that link a PR that is still open. @req FR:pr-page/group.@function */
export function activeAgents(inv: { sessions: { state: string; prs: { url: string; state: string }[] }[] }): { count: number; prs: Set<string> } {
  const prs = new Set<string>();
  let count = 0;
  for (const s of inv.sessions) {
    if (s.state !== 'running') continue;
    const open = s.prs.filter((p) => !/^(merged|closed)$/i.test(p.state));
    if (!open.length) continue;
    count++;
    for (const p of open) prs.add(p.url.toLowerCase());
  }
  return { count, prs };
}

export type BoardCounts = Record<PrGroup, number>;

// ---- next action, sign-off threads, details @req FR:pr-page/card.action @req FR:pr-page/detail.data

/** My words that ask an agent to wait: the Sign-off phrases. */
const WAIT = /\b(hold|wait|my ack|ack first|until i ack|don'?t merge|do not merge)\b/i;
const threadComments = (t: PrThread): PrComment[] => (t.comments?.length ? t.comments : [{ author: t.lastAuthor, body: t.lastBody, ...(t.url ? { url: t.url } : {}) }]);
const askIn = (t: PrThread, user: string): PrComment | undefined => threadComments(t).find((c) => isHuman(c.author, c.body, user) && WAIT.test(unquoted(c.body)));

/** Unresolved threads where I asked to wait, or that I acked. Oldest first. @req FR:pr-page/card.action */
export function signoffThreads(pr: PrFacts, ctx: BoardCtx): PrThread[] {
  const acks = ctx.acks?.get(pr.url.toLowerCase()) ?? [];
  const acked = (t: PrThread) => acks.some((a) => a.thread === t.url || threadComments(t).some((c) => c.url && c.url === a.thread));
  return unresolvedOf(pr).filter((t) => !!askIn(t, ctx.user) || acked(t));
}

/** The changed spec lines; null when the files are not known. @req FR:pr-review-lane/sort.lines */
const specLinesOf = (pr: PrFacts): number | null => (pr.files ? pr.files.filter((f) => isSpecPath(f.path)).reduce((n, f) => n + (f.additions || 0) + (f.deletions || 0), 0) : null);
const needsLive = (pr: PrFacts) => needsLiveValidation({ labels: pr.labels, body: pr.body, paths: (pr.files ?? []).map((f) => f.path) }).live;

/**
 * The one next action for me on a PR, first match wins. Pure. `live` is the Live PR url.
 * @req FR:pr-page/card.action
 */
export function nextActionOf(pr: PrFacts, ctx: BoardCtx, group: PrGroup, live: string | undefined): NextAction | null {
  if (live && same(live, pr.url)) return 'validate';
  if (signoffThreads(pr, ctx).length) return 'signoff';
  const rv = pr.pendingReview;
  if (rv && (rv.body.trim() || rv.comments.length)) return 'publish';
  const ci = ciOf(pr.checks);
  if (group === 'waiting' && !pr.draft && (ci === 'passing' || ci === 'none') && pr.mergeable !== 'CONFLICTING' && pr.reviews.find((v) => same(v.author, ctx.user))?.state !== 'APPROVED') return 'approve';
  if (same(pr.author, ctx.user) && !isAutopilot(pr) && !has(pr, LABELS.paused) && !pr.draft) {
    const open = unresolvedOf(pr);
    if (open.length === 0 || (open.length === 1 && !same(open[0].lastAuthor, ctx.user))) return 'autopilot';
  }
  return null;
}

/** List items under the first PR body heading that holds `validat`. @req FR:pr-page/detail.validate */
export function validationSteps(body: string): string[] {
  const lines = (body ?? '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s{0,3}#{1,6}\s.*validat/i.test(l));
  if (start < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^\s{0,3}#{1,6}\s/.test(l)) break;
    const m = /^\s*(?:\d+[.)]|[-*+])\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(l);
    if (m) out.push(firstLine(m[1], 300));
    if (out.length === 30) break;
  }
  return out;
}

const afterAt = (at: string | undefined, x: { at?: string }) => !at || !x.at ? false : Date.parse(x.at) > Date.parse(at);
/** Facts for the details pane. No AI call. @req FR:pr-page/detail.data */
function detailOf(pr: PrFacts, ctx: BoardCtx, action: NextAction | null): PrDetail {
  const d: PrDetail = {};
  const threads = signoffThreads(pr, ctx);
  if (threads.length) {
    d.signoff = threads.map((t) => {
      const list = threadComments(t);
      const ask = askIn(t, ctx.user) ?? list[0];
      const i = list.indexOf(ask);
      return {
        id: t.nodeId ?? '', url: t.url ?? ask.url ?? pr.url, ...(t.path ? { path: t.path } : {}), ask, after: list.slice(i + 1),
        commits: (pr.commits ?? []).filter((c) => afterAt(ask.at, c)).slice(-10).reverse(),
      };
    });
  }
  if (pr.pendingReview) d.review = pr.pendingReview;
  if (action === 'validate') {
    if (ctx.live && same(ctx.live.url, pr.url)) d.steps = { source: 'lane', state: ctx.live.state, ...(ctx.live.serverUrl ? { serverUrl: ctx.live.serverUrl } : {}), items: ctx.live.items };
    else d.steps = { source: 'body', items: validationSteps(pr.body).map((text) => ({ text })) };
  }
  const mineSaid = [...(pr.comments ?? []), ...(pr.threads ?? []).flatMap(threadComments)].filter((c) => isHuman(c.author, c.body, ctx.user) && c.url);
  if (mineSaid.length) d.notes = mineSaid.map((c, i) => ({ c, i })).sort((a, b) => (Date.parse(b.c.at ?? '') || 0) - (Date.parse(a.c.at ?? '') || 0) || b.i - a.i).slice(0, 5).map(({ c }) => ({ body: c.body.slice(0, 1000), url: c.url!, ...(c.at ? { at: c.at } : {}) }));
  return d;
}

/** Facts to rows, grouped and sorted, each with its next action. @req FR:pr-page/data.row */
export function buildRows(facts: PrFacts[], ctx: BoardCtx): PrRow[] {
  const keep: { pr: PrFacts; st: PrState; group: PrGroup }[] = [];
  const seen = new Set<string>();
  for (const pr of facts) {
    const key = pr.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const group = groupOf(pr, ctx);
    if (group) keep.push({ pr, st: stateOf(pr, ctx), group });
  }
  const base = keep.map(({ pr, st, group }) => {
    const key = pr.url.toLowerCase();
    const rec = ctx.recs?.get(key);
    const row: PrRow = {
      url: pr.url, repo: pr.repo, number: pr.number, title: pr.title, author: pr.author, project: projectOfRepo(pr.repo), group, draft: pr.draft,
      createdAt: pr.createdAt, updatedAt: pr.updatedAt, ci: ciOf(pr.checks), unresolved: unresolvedOf(pr).length, labels: pr.labels, state: st,
      bucket: rowBucket(group, pr, st), healthy: group === 'processing' && isHealthy(st), agent: ctx.agentPrs.has(key), after: afterOf(pr.body, pr.repo),
      rank: ctx.ranks?.get(key) ?? null, pinned: !!ctx.pinned?.has(key), autopilot: isAutopilot(pr), ...(rec ? { rec } : {}),
      mine: same(pr.author, ctx.user), nextAction: null, specLines: specLinesOf(pr), detail: {},
    };
    return { pr, row };
  }).sort((a, b) => compareRows(a.row, b.row));
  const live = liveUrlOf(base, ctx);
  for (const { pr, row } of base) { row.nextAction = nextActionOf(pr, ctx, row.group, live); row.detail = detailOf(pr, ctx, row.nextAction); }
  return base.map((x) => x.row);
}

/** The Live PR: the lane PR, else the escalation set entry, else my first PR that needs live validation. Must be a board row. */
function liveUrlOf(rows: { pr: PrFacts; row: PrRow }[], ctx: BoardCtx): string | undefined {
  const on = (u?: string) => (u ? rows.find((x) => same(x.row.url, u))?.row.url : undefined);
  return on(ctx.live?.url) ?? on(ctx.liveFirst) ?? rows.find((x) => x.row.mine && !x.row.draft && needsLive(x.pr))?.row.url;
}

export const ACTION_WORD: Record<NextAction, string> = { validate: 'Validate', signoff: 'Sign off', approve: 'Approve', publish: 'Publish review', autopilot: 'Enable Autopilot' };
/** Our words only: never hold, escalate, or blocked in UI text. @req FR:pr-page/summary.missing */
export const plainWords = (t: string) => t.replace(/\bheld thread\b/gi, 'sign-off thread').replace(/\bheld\b/gi, 'waiting for sign-off').replace(/\bon hold\b/gi, 'waiting for sign-off').replace(/\bhold\b/gi, 'sign-off')
  .replace(/\bescalat(?:ed|es|ion|ions|e)\b/gi, 'ask').replace(/\bblocked\b/gi, 'stuck').replace(/\bblocker\b/gi, 'ask').replace(/\bunblock\b/gi, 'clear');

/**
 * The Summary tab: 1 Live PR, up to 3 sign-offs, up to 3 ready for Autopilot, and everything else that needs me. Pure.
 * @req FR:pr-page/summary.@function @req FR:pr-page/summary.live @req FR:pr-page/summary.signoff @req FR:pr-page/summary.autopilot @req FR:pr-page/summary.missing
 */
export function summaryOf(rows: PrRow[], ctx: Pick<BoardCtx, 'live'> = {}): PrSummary {
  const live = rows.filter((r) => r.nextAction === 'validate').slice(0, 1).map((r) => r.url);
  const signoff = rows.filter((r) => r.nextAction === 'signoff').slice(0, 3).map((r) => r.url);
  const lines = (r: PrRow) => (r.specLines === null ? Infinity : r.specLines);
  const autopilot = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.nextAction === 'autopilot').sort((a, b) => lines(a.r) - lines(b.r) || a.i - b.i).slice(0, 3).map(({ r }) => r.url);
  const shown = new Set([...live, ...signoff, ...autopilot]);
  const missing: PrSummary['missing'] = [];
  for (const r of rows) if (r.nextAction && !shown.has(r.url)) { missing.push({ url: r.url, reason: ACTION_WORD[r.nextAction] }); shown.add(r.url); }
  for (const r of rows) if (!r.nextAction && r.state.owner === 'me' && !shown.has(r.url)) { missing.push({ url: r.url, reason: plainWords(r.state.blocker) || 'Needs you' }); shown.add(r.url); }
  const lane = ctx.live && rows.find((r) => same(r.url, ctx.live!.url));
  if (lane) for (const it of ctx.live!.items) if (it.state === 'failed' || it.state === 'needs-fix' || it.state === 'blocked') missing.push({ url: lane.url, reason: `Live check failed: ${firstLine(it.text, 120)}` });
  return { live, signoff, autopilot, missing };
}

export function countRows(rows: PrRow[]): BoardCounts {
  const c = Object.fromEntries(PR_GROUPS.map((g) => [g, 0])) as BoardCounts;
  for (const r of rows) c[r.group]++;
  return c;
}

/** running · waiting · parked. @req FR:pr-page/group.footer */
export function footerOf(rows: PrRow[], agents: number): { running: number; waiting: number; parked: number } {
  return {
    running: agents,
    waiting: rows.filter((r) => r.state.owner === 'me' || r.group === 'waiting' || (r.group === 'pending' && !r.draft)).length,
    parked: rows.filter((r) => r.group === 'paused' || (r.group === 'pending' && r.draft)).length,
  };
}

// ---- the pr-priority store files (read-only here; `FR:pr-priority/*` owns them)

const GH = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\/[\w./#?=&-]*)?$/;
const PR_URL = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100})\/pull\/(\d{1,7})$/;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const line = (v: unknown, n = 300): string | undefined => (typeof v === 'string' && v.trim() ? firstLine(v, n) : undefined);
const link = (v: unknown): string | undefined => (typeof v === 'string' && GH.test(v) ? v : undefined);
const urlOfKey = (k: string) => { const m = /^(.+)#(\d+)$/.exec(k); return m ? `https://github.com/${m[1]}/pull/${m[2]}` : ''; };
const BUCKETS = ['approve', 'review', 'decide', 'unblock'];

/** One SM record (`FR:pr-priority/record.model`) to a report; a bad field drops the report, not the row. @req FR:pr-page/data.report */
function parseRecord(v: unknown): PrReport | undefined {
  const o = obj(v);
  if (!o || typeof o.state !== 'string') return undefined;
  if (o.headSha !== undefined && (typeof o.headSha !== 'string' || !/^[0-9a-f]{7,40}$/i.test(o.headSha))) return undefined;
  const b = obj(o.blocker);
  const blocker = line(b?.text, 200);
  return {
    owner: typeof o.owner === 'string' ? o.owner : o.state === 'blocked-on-me' || o.state === 'waiting-on-me' ? 'michael' : 'none', state: o.state,
    ...(line(o.worker, 60) ? { worker: line(o.worker, 60) } : {}), ...(blocker ? { blocker } : {}), ...(line(o.nextAction) ? { nextAction: line(o.nextAction) } : {}),
    ...(o.headSha ? { headSha: (o.headSha as string).toLowerCase() } : {}), ...(line(o.ts, 40) ? { ts: line(o.ts, 40) } : {}),
    ...(link(b?.threadUrl) ? { link: link(b?.threadUrl) } : {}), ...(typeof o.bucket === 'string' && BUCKETS.includes(o.bucket) ? { bucket: o.bucket as Bucket } : {}),
  };
}

/** One escalation entry `{pr, ...}` to an entry; the thread link comes from the PR's record. */
function parseEntry(v: unknown, fields: Partial<Record<'blocker' | 'context' | 'recommend', string>>, records: Map<string, PrReport>): EscEntry | undefined {
  const o = obj(v);
  const m = typeof o?.pr === 'string' ? PR_URL.exec(o.pr) : null;
  if (!o || !m) return undefined;
  const e: EscEntry = { repo: m[1], number: Number(m[2]), url: o.pr as string, project: projectOfRepo(m[1]) };
  for (const [to, from] of Object.entries(fields)) { const t = line(o[from]); if (t) e[to as 'blocker'] = t; }
  const l = records.get(e.url.toLowerCase())?.link; if (l) e.link = l;
  return e;
}

export interface PrAck { thread: string; note: string; at: string }
export interface QueueView {
  ranks: Map<string, number>; pinned: Set<string>; reports: Map<string, PrReport>; escalations?: Escalations;
  acks: Map<string, PrAck[]>; recs: Map<string, PrRec>; exclude: string[];
}
/**
 * The pr-priority store: `pr-priority.json` (queue), `pr-priority-state.json` (records, escalations, acks, recommendations),
 * `pr-priority.config.json` (exclude). Tolerant: anything broken reads as empty. Keys are lowercase PR urls.
 * @req FR:pr-page/data.report @req FR:pr-page/data.escalations @req FR:pr-page/data.recs
 */
export function parseQueue(files: { queue?: unknown; state?: unknown; config?: unknown }): QueueView {
  const out: QueueView = { ranks: new Map(), pinned: new Set(), reports: new Map(), acks: new Map(), recs: new Map(), exclude: [] };
  const q = obj(files.queue);
  for (const it of Array.isArray(q?.items) ? (q!.items as unknown[]) : []) {
    const i = obj(it);
    const url = typeof i?.url === 'string' && PR_URL.test(i.url) ? i.url.toLowerCase() : undefined;
    if (!i || !url) continue;
    if (Number.isInteger(i.rank)) out.ranks.set(url, i.rank as number);
    if (i.pinned === true) out.pinned.add(url);
  }
  const st = obj(files.state);
  for (const [k, v] of Object.entries(obj(st?.records) ?? {})) { const r = parseRecord(v); const u = urlOfKey(k); if (r && u) out.reports.set(u.toLowerCase(), r); }
  for (const [k, v] of Object.entries(obj(st?.acks) ?? {})) {
    const list = (Array.isArray(v) ? v : []).flatMap((a) => { const o = obj(a); const thread = typeof o?.thread === 'string' && /^https:\/\//.test(o.thread) ? o.thread : ''; const note = line(o?.note); return thread && note ? [{ thread, note, at: String(o?.at ?? '') }] : []; });
    const u = urlOfKey(k);
    if (u && list.length) out.acks.set(u.toLowerCase(), list);
  }
  for (const it of Array.isArray(st?.recs) ? (st!.recs as unknown[]) : []) {
    const r = obj(it);
    if (!r || r.state !== 'open' || typeof r.id !== 'string' || !/^pp-[0-9a-f]{8}$/.test(r.id) || typeof r.url !== 'string' || !PR_URL.test(r.url)) continue;
    const reason = line(r.reason);
    if (!reason || typeof r.agent !== 'string') continue;
    out.recs.set(r.url.toLowerCase(), { id: r.id, agent: firstLine(r.agent, 40), reason, ...(Number.isInteger(r.toRank) ? { toRank: r.toRank as number } : {}) });
  }
  const e = obj(st?.escalations);
  if (e) {
    const list = (k: string, n: number, f: Parameters<typeof parseEntry>[1]) => (Array.isArray(e[k]) ? (e[k] as unknown[]) : []).map((x) => parseEntry(x, f, out.reports)).filter((x): x is EscEntry => !!x).slice(0, n);
    const esc: Escalations = {
      blocked: list('blockedAutopilot', 3, { blocker: 'exactBlocker', context: 'context', recommend: 'recommendedAnswer' }),
      enable: list('enableAutopilot', 3, { context: 'whyEasy' }), live: list('liveValidation', 1, { context: 'why' }),
      ...(line(e.at, 40) ? { at: line(e.at, 40) } : {}),
    };
    if (esc.blocked.length + esc.enable.length + esc.live.length) out.escalations = esc;
  }
  const c = obj(files.config);
  out.exclude = (Array.isArray(c?.exclude) ? (c!.exclude as unknown[]) : []).filter((x): x is string => typeof x === 'string');
  return out;
}
