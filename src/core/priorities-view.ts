/**
 * The owner's priorities report: QM (per project), Now (top 3), PRs, Today, Next 3 days. Project rows come only from the
 * tiered tasks in `tasks/*.md`, linked to the owner's day-aware priorities; a priority with no tiered task shows an explicit
 * gap. PR rows come only from the live PR board. Each row and section is stamped with its last live check.
 * Pure: the caller reads the stores and hands them in.
 * @req FR:priorities-tables/rows.@function @req FR:priorities-tables/rows.input @req FR:priorities-tables/$view @req FR:priorities-tables/$row @req FR:priorities-tables/$pr
 */
import type { NextAction, PrDetail } from './pr-board';
import type { Pri, PriDay, PriWindow } from './pris';
import { linker, priOrder, type LinkRow } from './pris-rank';
import type { AgentStatus, ProjectFile, TieredTask } from './tiered-tasks';

/** One PR board row, as the report needs it. `specLines` is the changed spec lines (null when unknown). */
export interface BoardRowInput { url: string; repo: string; number: number; title: string; project: string; nextAction: NextAction | null; specLines?: number | null; /** Live test server, for validate rows. */ server?: string | null; /** Where it says what to validate (agent thread or comment). */ details?: string | null }
/** The PR board: `at` is the last good poll (null before the first). */
export interface BoardInput { at: string | null; rows: BoardRowInput[] }
/** The session inventory: `at` is its last read. */
export interface SessionsInput { at: string; sessions: { id: string; title: string; link: string; /** The Claude Code session id. */ cli?: string }[] }
export interface ViewInput {
  pris: Pri[]; tasks: TieredTask[];
  /** Every project file (for the project link of gap rows). */ files?: ProjectFile[];
  /** Agent file paths (`tasks/.stack/agents/<slug>.md`, `.claude/agents/<slug>.md`). */ agents?: string[];
  now: Date; timeZone?: string; sessions?: SessionsInput; board?: BoardInput }

/** `link`: the session; `file`: the agent file when no session matches; `session`: the id `POST /sessions/{id}/prompt` takes, or null. @req FR:priorities-tables/agent.session */
export interface Agent { name: string; link: string | null; file: string | null; session: string | null }
export interface PriRow { id: string; project: string; /** The project task file. */ file: string | null; agent: Agent | null; /** More agents on the same goal (`+N` in the task). @req FR:priorities-tables/rows.cols.more */ more: number; status: AgentStatus | null; action: string; gap: boolean; /** Gap rows: the Chief of Staff who must add the task. @req FR:priorities-tables/rows.gap.cos */ cos: Agent | null; ref: string | null; at: string; stale: boolean }
export interface PriTable { at: string; stale: boolean; rows: PriRow[] }
export interface QmTable extends PriTable { title: string; /** QM is a priority today (its day order and windows keep it in). @req FR:priorities-tables/qm.today */ today: boolean }
export interface PrRow { emoji: string; number: number; url: string; agent: Agent | null; /** The id of the priority the PR links to. @req FR:priorities-tables/pr.cols.pri */ pri: string | null; action: string; minutes: number; server: string | null; details: string | null }
export interface PrTable { at: string; stale: boolean; verified: boolean; /** The Sweep Manager session, shown above the table. */ manager: Agent | null; rows: PrRow[] }
export interface PrioritiesView { at: string; /** IANA zone the report was built in; stamps show times in it. */ timeZone?: string; qm: QmTable | null; now: PriTable; prs: PrTable; today: PriTable; next: PriTable }

const NOW_ROWS = 3;
const NEXT_DAYS = 3;
const WORDS = 20;
const STALE_MS = 30 * 60_000;
const DAY_MS = 86_400_000;
/** The CoS when the priority names none: the roll-up. */
export const COS = 'CoS';
/** What the owner can expect from the CoS on a gap row. @req FR:priorities-tables/rows.gap.action */
const gapTask = (file: string | null) => `1️⃣/2️⃣/3️⃣ in ${file ?? 'tasks/<project>.md'} with (agent: ...)`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const OFF_TODAY = 'Not a priority today';

/**
 * At most 20 words; a cut cell ends with an ellipsis.
 * @req FR:priorities-tables/rows.words
 */
export function cut(s: string, n = WORDS): string {
  const w = s.trim().split(/\s+/).filter(Boolean);
  return w.length <= n ? w.join(' ') : `${w.slice(0, n).join(' ')}…`;
}

/** Weekday and minute of the day of `at` in `timeZone`. */
function wall(at: Date, timeZone?: string): { day: PriDay; min: number } {
  const parts = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}) }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { day: get('weekday').toLowerCase().slice(0, 3) as PriDay, min: Number(get('hour')) * 60 + Number(get('minute')) };
}
const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
/** `15:00` to `3 PM`, `15:30` to `3:30 PM`. */
export function clockText(hhmm: string): string {
  const h = Number(hhmm.slice(0, 2)); const m = hhmm.slice(3);
  return `${h % 12 || 12}${m === '00' ? '' : `:${m}`} ${h < 12 ? 'AM' : 'PM'}`;
}
const dayName = (d: PriDay) => `${d[0].toUpperCase()}${d.slice(1)}`;
const onDay = (w: PriWindow, d: PriDay) => !w.days || w.days.includes(d);

type Today = { state: 'open' } | { state: 'later'; from: string } | { state: 'past' };
/** Whether a priority is open now, opens later today, or is done for today. @req FR:priorities-tables/order.window @req FR:priorities-tables/order.window.day @req FR:priorities-tables/order.window.edge */
function todayOf(p: Pri, day: PriDay, min: number): Today {
  if (!p.windows?.length) return { state: 'open' };
  let later: string | undefined;
  for (const w of p.windows.filter((x) => onDay(x, day))) {
    const from = w.from ? mins(w.from) : 0; const to = w.to ? mins(w.to) : 1440;
    if (from <= min && min < to) return { state: 'open' };
    if (from > min && (!later || w.from! < later)) later = w.from!;
  }
  return later ? { state: 'later', from: later } : { state: 'past' };
}

/**
 * The project name: the label, else the title before the first parenthesis.
 * @req FR:priorities-tables/rows.project
 */
const projectOf = (p: Pri) => cut(p.label ?? (p.title.split('(')[0].trim() || p.title));
const stamp = (now: Date, times: number[]) => { const at = Math.min(now.getTime(), ...times.filter((t) => !Number.isNaN(t))); return { at: new Date(at).toISOString(), stale: now.getTime() - at > STALE_MS }; };
/** Lowest tier, then file order. @req FR:priorities-tables/rows.pick */
const pick = (ts: TieredTask[]) => ts.reduce<TieredTask | undefined>((b, t) => (!b || t.tier < b.tier ? t : b), undefined);
const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Repo emoji by repo name. @req FR:priorities-tables/pr.cols.emoji */
const REPO_EMOJI: Record<string, string> = { 'finops-hubs': '🏦', 'finops-toolkit': '🧰', focus_spec: '👓', 'f4-music': '🎧', printer: '🖨️', stack: '🥞', catalyst: '⚛️', 'allyte-web': '🌐', prime: '🏭' };
/** @req FR:priorities-tables/pr.cols.action @req FR:priorities-tables/pr.cols.time */
const PR_ACTION: Record<NextAction, { text: string; minutes: number }> = {
  autopilot: { text: 'Autopilot: promote', minutes: 5 }, approve: { text: 'Approve', minutes: 5 }, signoff: { text: 'Thread: sign off', minutes: 5 },
  publish: { text: 'Publish review', minutes: 10 }, validate: { text: 'Live: validate', minutes: 15 },
};
const SPEC_LINES_PER_MIN = 20;

/**
 * The report. Tasks link to a `perProject` priority (QM) first, then to the others. QM gets its own first section; the rest
 * follow the day order: the first 3 open in Now, the rest of today in Today, the next 3 days in Next 3 days.
 * @req FR:priorities-tables/rows.status @req FR:priorities-tables/rows.link @req FR:priorities-tables/qm.link @req FR:priorities-tables/order.day
 * @req FR:priorities-tables/order.now @req FR:priorities-tables/order.today @req FR:priorities-tables/order.today.later @req FR:priorities-tables/order.today.past
 * @req FR:priorities-tables/order.next @req FR:priorities-tables/order.next.when @req FR:priorities-tables/order.next.sort
 */
export function prioritiesView(input: ViewInput): PrioritiesView {
  const { now, timeZone, sessions, board } = input;
  const live = input.pris.filter((p) => p.status === 'active' || p.status === 'blocked');
  const qmPri = live.find((p) => p.perProject);
  const rest = live.filter((p) => p !== qmPri);
  const names = [...new Set(input.tasks.flatMap((t) => [t.project, ...t.aliases]))];
  const linkQm = linker(qmPri ? [qmPri] : [], names);
  const linkRest = linker(rest, names);
  const linkOf = (r: LinkRow) => linkQm(r) ?? linkRest(r);
  const byPri = new Map<string, TieredTask[]>();
  for (const t of input.tasks) {
    const l = linkOf({ text: t.text, project: t.project, aliases: t.aliases });
    if (l) byPri.set(l.id, [...(byPri.get(l.id) ?? []), t]);
  }

  /** The inventory session whose title matches the agent, else the priority session. @req FR:priorities-tables/agent.link @req FR:priorities-tables/agent.plain */
  const sessionOf = (agent: string | null, p: Pri) => {
    const list = sessions?.sessions ?? [];
    return (agent ? list.find((s) => norm(s.title) === norm(agent)) : undefined) ?? (p.session ? list.find((s) => s.id === p.session) : undefined);
  };
  /** @req FR:priorities-tables/fresh.row @req FR:priorities-tables/fresh.stale */
  /** The project file: by the priority projects, else by its name. @req FR:priorities-tables/rows.file */
  const fileOf = (p: Pri): string | null => {
    const want = new Set([...(p.projects ?? []), projectOf(p), p.title].map((x) => x.toLowerCase()));
    return input.files?.find((f) => [f.project, ...f.aliases].some((n) => want.has(n.toLowerCase())))?.path ?? null;
  };
  /** The agent: its session (with the id a prompt takes, when it is a UUID), else its agent file. @req FR:priorities-tables/agent.session @req FR:priorities-tables/agent.link @req FR:priorities-tables/agent.file @req FR:priorities-tables/agent.plain */
  const slug = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  const agentOf = (name: string, s?: { link: string; cli?: string }): Agent => ({ name: cut(name), link: s?.link ?? null, session: s?.cli && UUID.test(s.cli) ? s.cli : null, file: s ? null : input.agents?.find((a) => (a.split('/').pop() ?? '').replace(/\.md$/, '') === slug(name)) ?? null });
  const byName = (name: string) => (sessions?.sessions ?? []).find((s) => norm(s.title) === norm(name));
  /** A row that is not a task: QM off today. */
  const noteRow = (p: Pri, action: string): PriRow => ({ id: p.id, project: projectOf(p), file: fileOf(p), agent: null, more: 0, status: null, action, gap: false, cos: null, ref: null, ...stamp(now, []) });
  /**
   * No tiered task: who will act (the CoS), by when (today, else the start of the row) and what to expect. The row carries no text to send.
   * @req FR:priorities-tables/rows.gap @req FR:priorities-tables/rows.gap.cos @req FR:priorities-tables/rows.gap.by @req FR:priorities-tables/rows.gap.action @req FR:priorities-tables/rows.gap.silent
   */
  const gapRow = (p: Pri, when = '', project = projectOf(p)): PriRow => {
    const file = fileOf(p);
    const s = byName(p.cos ?? COS);
    const cos = agentOf(p.cos ?? COS, s);
    const by = when ? `by ${when.replace(/: $/, '')}` : 'today';
    return {
      id: p.id, project, file, agent: null, more: 0, status: null, action: cut(`${cos.name} will add a task ${by}: ${gapTask(file)}`), gap: true, cos,
      ref: null, ...stamp(now, s ? [Date.parse(sessions!.at)] : []),
    };
  };
  /**
   * @req FR:priorities-tables/rows.cols @req FR:priorities-tables/rows.cols.action @req FR:priorities-tables/rows.cols.later @req FR:priorities-tables/rows.cols.more
   * @req FR:priorities-tables/rows.gap @req FR:priorities-tables/fresh.row
   */
  const rowOf = (p: Pri, t: TieredTask | undefined, when = '', project = projectOf(p)): PriRow => {
    if (!t) return gapRow(p, when, project);
    const s = t.agent ? sessionOf(t.agent, p) : undefined;
    const agent = t.agent ? agentOf(t.agent, s) : null;
    const action = cut(`${when}${t.tier > 1 ? '⏳ ' : ''}${p.action ?? t.text}${t.more ? ` + ${t.more} more` : ''}`);
    return { id: p.id, project, file: t.path, agent, more: t.more, status: t.status, action, gap: false, cos: null, ref: `${t.path}:${t.line}`, ...stamp(now, s ? [Date.parse(sessions!.at)] : []) };
  };
  /** @req FR:priorities-tables/fresh.table */
  const table = (rows: PriRow[]): PriTable => ({ ...stamp(now, rows.map((r) => Date.parse(r.at))), rows });

  const { day, min } = wall(now, timeZone);
  const order = priOrder(live, now, timeZone);

  /** @req FR:priorities-tables/qm.pri @req FR:priorities-tables/qm.rows @req FR:priorities-tables/qm.off @req FR:priorities-tables/qm.later */
  let qm: QmTable | null = null;
  if (qmPri) {
    const t = order.includes(qmPri) ? todayOf(qmPri, day, min) : { state: 'past' as const };
    let rows: PriRow[];
    if (t.state === 'past') rows = [noteRow(qmPri, OFF_TODAY)];
    else {
      const when = t.state === 'later' ? `${clockText(t.from)}: ` : '';
      const files = new Map<string, TieredTask[]>();
      for (const x of byPri.get(qmPri.id) ?? []) files.set(x.path, [...(files.get(x.path) ?? []), x]);
      rows = [...files.keys()].sort().map((path) => { const x = pick(files.get(path)!)!; return rowOf(qmPri, x, when, cut(x.project)); });
      if (!rows.length) rows = [gapRow(qmPri, when)];
    }
    qm = { title: projectOf(qmPri), today: t.state !== 'past', ...table(rows) };
  }

  const open: PriRow[] = []; const today: PriRow[] = [];
  const shown = new Set<string>();
  for (const p of order) {
    if (p === qmPri) continue;
    const t = todayOf(p, day, min);
    if (t.state === 'past') continue;
    shown.add(p.id);
    const task = pick(byPri.get(p.id) ?? []);
    if (t.state === 'open' && open.length < NOW_ROWS) open.push(rowOf(p, task));
    else today.push(rowOf(p, task, t.state === 'later' ? `${clockText(t.from)}: ` : ''));
  }
  const next: PriRow[] = [];
  for (let d = 1; d <= NEXT_DAYS; d++) {
    // Probe at local noon so a 23 or 25 hour DST day still lands on the next calendar day.
    const at = new Date(now.getTime() + (12 * 60 - min) * 60_000 + d * DAY_MS);
    const dd = wall(at, timeZone).day;
    for (const p of priOrder(rest, at, timeZone)) {
      if (shown.has(p.id)) continue;
      // The earliest window of that day gives the start time.
      const w = p.windows?.length ? p.windows.filter((x) => onDay(x, dd)).sort((a, b) => (a.from ?? '') < (b.from ?? '') ? -1 : 1)[0] : {};
      if (!w) continue;
      shown.add(p.id);
      next.push(rowOf(p, pick(byPri.get(p.id) ?? []), `${dayName(dd)}${w.from ? ` ${clockText(w.from)}` : ''}: `));
    }
  }

  /**
   * PRs that need the owner, from the live board only, quickest first.
   * @req FR:priorities-tables/pr.live @req FR:priorities-tables/pr.live.none @req FR:priorities-tables/pr.cols @req FR:priorities-tables/pr.cols.agent @req FR:priorities-tables/pr.cols.pri @req FR:priorities-tables/pr.order
   */
  const prsOf = (): PrTable => {
    // @req FR:priorities-tables/pr.manager
    const m = sessions?.sessions.find((s) => norm(s.title).includes('sweepmanager'));
    const manager = m ? { ...agentOf('Sweep Manager', m) } : null;
    if (!board?.at) return { at: now.toISOString(), stale: true, verified: false, manager, rows: [] };
    const byId = new Map(live.map((p) => [p.id, p]));
    const link = linker(live, names);
    const rows = board.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.nextAction)
      .map(({ r, i }) => {
        const a = PR_ACTION[r.nextAction!];
        const l = link({ text: `${r.title} ${r.url} ${r.repo}#${r.number}`, project: r.project, aliases: [] });
        const p = l ? byId.get(l.id) : undefined;
        // The priority session, else the agent of the project row the PR's priority shows. @req FR:priorities-tables/pr.cols.agent
        const s = p ? sessionOf(null, p) : undefined;
        const top = p ? pick(byPri.get(p.id) ?? []) : undefined;
        const ts = !s && top?.agent ? sessionOf(top.agent, p!) : undefined;
        const row: PrRow = {
          emoji: REPO_EMOJI[(r.repo.split('/').pop() ?? '').toLowerCase()] ?? '', number: r.number, url: r.url,
          agent: s ? agentOf(s.title, s) : top?.agent ? agentOf(top.agent, ts) : null, pri: p?.id ?? null, action: a.text,
          minutes: a.minutes + Math.floor((typeof r.specLines === 'number' ? r.specLines : 0) / SPEC_LINES_PER_MIN),
          // @req FR:priorities-tables/pr.cols.live
          server: r.nextAction === 'validate' ? r.server ?? null : null, details: r.nextAction === 'validate' ? r.details ?? null : null,
        };
        return { row, i };
      })
      .sort((a, b) => a.row.minutes - b.row.minutes || a.i - b.i)
      .map(({ row }) => row);
    return { ...stamp(now, [Date.parse(board.at)]), verified: true, manager, rows };
  };

  return { at: now.toISOString(), ...(timeZone ? { timeZone } : {}), qm, now: table(open), prs: prsOf(), today: table(today), next: table(next) };
}

/** The PR board as the report needs it: rows and the last good poll. */
export function boardInput(b: { at: string | null; rows: (Omit<BoardRowInput, 'server' | 'details'> & { detail?: PrDetail; state?: { link?: string } })[] }): BoardInput {
  return {
    at: b.at,
    rows: b.rows.map(({ url, repo, number, title, project, nextAction, specLines, detail, state }) => {
      const steps = detail?.steps;
      const server = steps && steps.source === 'lane' ? steps.serverUrl ?? null : null;
      const details = state?.link && state.link !== url ? state.link : detail?.notes?.[0]?.url ?? null;
      return { url, repo, number, title, project, nextAction, specLines: specLines ?? null, server, details };
    }),
  };
}

/** `11:00 AM` in `timeZone`. */
export function timeText(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) }).format(new Date(iso)).replace(/\s/g, ' ');
}
