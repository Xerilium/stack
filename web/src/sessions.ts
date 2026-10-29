/**
 * Pure helpers for the Sessions view: formatting, the cost strip, and folding a run's update stream into a transcript.
 * @req FR:agent-sessions/web.view @req FR:agent-sessions/web.drawer @req FR:agent-sessions/web.cost @req FR:agent-sessions/web.message
 */
export type SessionState = 'needs-you' | 'running' | 'active' | 'idle' | 'stale';
export interface SessionItem { id: string; title: string; project: string; cwd: string; branch?: string; lastActive: string; state: SessionState; cost: { usd: number; tokens: number; approx?: boolean }; prs: string[] }
export interface SessionList { items: SessionItem[]; total: number; indexing?: number }
export interface Turn { at: string; role: 'user' | 'assistant'; text: string }
export interface CostDay { date: string; usd: number; tokens: number; sessions: number }
export interface CostReport { attribution: 'lastActive'; indexing?: number; days: CostDay[]; projects: { project: string; usd: number; tokens: number; sessions: number }[]; models: { model: string; usd: number; tokens: number }[]; total: { usd: number; tokens: number; sessions: number } }
export type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type Update =
  | { type: 'session'; sessionId: string }
  | { type: 'message_chunk'; role: 'assistant' | 'user'; text: string }
  | { type: 'tool_call'; callId: string; title: string; kind: string; status: ToolStatus }
  | { type: 'tool_update'; callId: string; status: ToolStatus; output?: string }
  | { type: 'permission'; requestId: string; callId: string; title: string; options: unknown[] }
  | { type: 'done'; stopReason: 'end_turn' | 'cancelled' | 'max_budget' | 'error'; cost: { usd: number; tokens: number }; turns: number; durationMs: number; error?: string };
export type Line = { kind: 'text'; role: 'user' | 'assistant'; text: string } | { kind: 'tool'; callId: string; title: string; toolKind: string; status: ToolStatus; output?: string };
export interface Transcript { lines: Line[]; tools: Map<string, number>; waiting: { callId: string; title: string } | null; done: { text: string; error: boolean } | null }

export const STATE_LABEL: Record<SessionState, string> = { 'needs-you': 'Needs you', running: 'Running', active: 'Active', idle: 'Idle', stale: 'Stale' };

export function fmtUsd(n: number): string {
  if (n <= 0) return '$0';
  if (n < 0.01) return '<$0.01';
  if (n < 10) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) { const k = n / 1000; return `${k < 10 ? k.toFixed(1) : Math.round(k)}k`; }
  if (n < 1e9) { const m = n / 1e6; return `${m < 10 ? m.toFixed(1) : Math.round(m)}M`; }
  const b = n / 1e9;
  return `${b < 10 ? b.toFixed(1) : Math.round(b)}B`;
}

export function ago(iso: string, now: Date): string {
  const s = Math.max(0, (now.getTime() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s) || s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** A worktree branch name carries no meaning in a row (`xe/zany-fox-1a2b3c`); the drawer shows it. */
export const slugBranch = (b?: string): boolean => !!b && /^[a-z]+\/[a-z]+-[a-z]+-[0-9a-f]{6}$/.test(b);

export function rowOf(s: SessionItem, now: Date): { label: string; where: string; when: string; cost: string } {
  return { label: STATE_LABEL[s.state], where: s.branch && !slugBranch(s.branch) ? `${s.project} · ${s.branch}` : s.project, when: ago(s.lastActive, now), cost: `${s.cost.approx ? '≈' : ''}${fmtUsd(s.cost.usd)}` };
}

/** Today as `YYYY-MM-DD` in the browser's timezone. */
export const localDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short' })} ${d}`;
}

export function costStrip(r: CostReport, today: string): { today: string; window: string } {
  const t = r.days.find((d) => d.date === today) ?? { usd: 0, tokens: 0, sessions: 0 };
  const approx = (r.indexing ?? 0) > 0 ? '≈' : '';
  return { today: `Today ${approx}${fmtUsd(t.usd)} · ${fmtTokens(t.tokens)} tokens · ${t.sessions} sessions`, window: `${r.days.length} days ${approx}${fmtUsd(r.total.usd)}${r.indexing ? ` · indexing ${r.indexing}` : ''}` };
}

export function barWidths(days: CostDay[]): number[] {
  const max = Math.max(0, ...days.map((d) => d.usd));
  return days.map((d) => (max > 0 ? Math.round((d.usd / max) * 100) : 0));
}

/** Folds one update into the transcript; returns a new transcript (the input is not changed). */
export function applyUpdate(t: Transcript, u: Update): Transcript {
  const lines = [...t.lines];
  const tools = new Map(t.tools);
  let { waiting, done } = t;
  switch (u.type) {
    case 'message_chunk': {
      const last = lines[lines.length - 1];
      if (last && last.kind === 'text' && last.role === u.role) lines[lines.length - 1] = { ...last, text: last.text + u.text };
      else lines.push({ kind: 'text', role: u.role, text: u.text });
      break;
    }
    case 'tool_call':
      tools.set(u.callId, lines.length);
      lines.push({ kind: 'tool', callId: u.callId, title: u.title, toolKind: u.kind, status: u.status });
      break;
    case 'tool_update': {
      const i = tools.get(u.callId);
      if (i !== undefined) { const l = lines[i] as Extract<Line, { kind: 'tool' }>; lines[i] = { ...l, status: u.status, ...(u.output !== undefined ? { output: u.output } : {}) }; }
      if (waiting?.callId === u.callId) waiting = null;
      break;
    }
    case 'permission':
      waiting = { callId: u.callId, title: u.title };
      break;
    case 'done':
      done = u.stopReason === 'end_turn' ? { text: `Done · ${fmtUsd(u.cost.usd)} · ${u.turns} ${u.turns === 1 ? 'turn' : 'turns'}`, error: false }
        : u.stopReason === 'cancelled' ? { text: 'Stopped', error: false }
        : u.stopReason === 'max_budget' ? { text: `Stopped at the budget · ${fmtUsd(u.cost.usd)}`, error: true }
        : { text: `Failed: ${u.error ?? 'unknown error'}`, error: true };
      waiting = null;
      break;
    default:
      return t;
  }
  return { lines, tools, waiting, done };
}

export function splitSessions<T>(items: T[], n: number, all = false): { shown: T[]; more: number } {
  return all || items.length <= n ? { shown: items, more: 0 } : { shown: items.slice(0, n), more: items.length - n };
}

export type HistoryLine = { kind: 'text'; role: 'user' | 'assistant'; text: string } | { kind: 'tools'; count: number; titles: string[]; summary: string };

/** History for reading: text turns as they are, runs of tool calls folded into one line ("12 tool calls · Bash ×9, Edit ×3"). */
export function groupTurns(turns: Turn[]): HistoryLine[] {
  const out: HistoryLine[] = [];
  for (const t of turns) {
    const m = /^⚙ ([^:]+):/.exec(t.text);
    if (!m) { out.push({ kind: 'text', role: t.role, text: t.text }); continue; }
    const last = out[out.length - 1];
    if (last && last.kind === 'tools') { last.count++; last.titles.push(t.text); } else out.push({ kind: 'tools', count: 1, titles: [t.text], summary: '' });
  }
  for (const l of out) {
    if (l.kind !== 'tools') continue;
    const by = new Map<string, number>();
    for (const title of l.titles) { const name = (/^⚙ ([^:]+):/.exec(title)?.[1] ?? 'tool').split('__').pop() ?? 'tool'; by.set(name, (by.get(name) ?? 0) + 1); }
    l.summary = [...by].sort((a, b) => b[1] - a[1]).map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(', ');
  }
  return out;
}
