/**
 * Pure logic for the Asks view: deadline wording, actions per kind, defer choices, cursor and diff helpers.
 * @req FR:ask-queue/web.home @req FR:ask-queue/web.card @req FR:ask-queue/web.actions @req FR:ask-queue/web.optimistic @req FR:ask-queue/web.empty @req FR:ask-queue/live.quiet
 */
export type AskKind = 'approve' | 'decide' | 'review' | 'go-do' | 'answer';
export type AnswerKind = 'go' | 'no' | 'option' | 'reply' | 'ask' | 'done' | 'defer' | 'retract';
export interface AskItem {
  key: string; state: 'open' | 'answered' | 'done'; ask: string; kind: AskKind; from: string;
  project?: string; why?: string; recommend?: string; options?: string[]; default?: string; by?: string; reversible: boolean; link?: string;
  priority: 'crit' | 'high' | 'normal' | 'low'; effort?: string; blocks: number; created: string; updated: string;
  answer?: AnswerKind; text?: string; answered?: string; snoozedUntil?: string; detail?: string;
  score: number; rank?: number; overdue: boolean; agentReply?: string;
}
export interface AskList { items: AskItem[]; total: number; latest?: string }
export interface Send { answer: AnswerKind; text?: string; until?: string }

const DAY = 86400_000;
const clock = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/ /g, ' ').replace(' AM', ' am').replace(' PM', ' pm');
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** "Today 3:00 pm" plus the distance ("in 3 h"); tone grows from calm to soon (under a day) to late. */
export function deadline(by: string | undefined, now: Date): { label: string; rel: string; tone: 'calm' | 'soon' | 'late' } | null {
  if (!by) return null;
  const d = new Date(by);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / DAY);
  const day = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days > 1 && days < 7 ? d.toLocaleDateString('en-US', { weekday: 'short' }) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const ms = d.getTime() - now.getTime();
  const abs = Math.abs(ms);
  const mins = Math.max(1, Math.round(abs / 60_000));
  const span = abs < 3600_000 ? `${mins} min` : abs < 36 * 3600_000 ? `${Math.round(abs / 3600_000)} h` : `${Math.round(abs / DAY)} d`;
  return { label: `${day} ${clock(d)}`, rel: ms < 0 ? `${span} overdue` : `in ${span}`, tone: ms < 0 ? 'late' : ms < DAY ? 'soon' : 'calm' };
}

/** The silent-default line. The default is shown only when it is safe to apply: reversible and stated. */
export function ifSilent(a: Pick<AskItem, 'reversible' | 'default'>): { text: string; waits: boolean } {
  return a.reversible && a.default ? { text: `If silent: ${a.default}`, waits: false } : { text: 'No default: waits for you', waits: true };
}

export interface Action { id: string; label: string; key: string; primary?: boolean; send?: Send; open?: boolean; reply?: boolean }

/** Buttons for an ask by kind. `Enter` is always the primary action. */
export function actionsFor(a: Pick<AskItem, 'kind' | 'recommend' | 'options' | 'link'>): Action[] {
  const open: Action[] = a.link ? [{ id: 'open', label: 'Open', key: 'o', open: true }] : [];
  const rec = a.recommend?.trim().toLowerCase();
  switch (a.kind) {
    case 'approve': {
      const reject = !!rec && /^(reject|no|decline|deny|hold)\b/.test(rec);
      return [
        { id: 'go', label: 'Approve', key: reject ? 'y' : 'Enter', primary: !reject, send: { answer: 'go' } },
        { id: 'no', label: 'Reject', key: reject ? 'Enter' : 'n', primary: reject, send: { answer: 'no' } },
        ...open,
      ];
    }
    case 'decide': {
      const opts = a.options ?? [];
      const at = Math.max(0, opts.findIndex((o) => o.toLowerCase() === rec));
      return opts.map((o, i) => ({ id: `opt-${i}`, label: o, key: String(i + 1), primary: i === at, send: { answer: 'option' as const, text: o } }));
    }
    case 'review':
      return [{ id: 'go', label: 'Looks good', key: 'Enter', primary: true, send: { answer: 'go' } }, { id: 'changes', label: 'Needs changes', key: 'n', reply: true }, ...open];
    case 'go-do':
      return [{ id: 'done', label: 'Done', key: 'Enter', primary: true, send: { answer: 'done' } }, ...open];
    default:
      return [];
  }
}

/** A question goes to the agent as `ask` (it answers back); anything else is an instruction (`reply`). */
export const replyKind = (text: string): 'ask' | 'reply' => (text.trim().endsWith('?') ? 'ask' : 'reply');

export interface DeferChoice { key: string; label: string; at: Date }

/** Defer targets: an hour, this evening (before 4 pm), tomorrow 9 am (weekdays), the next Monday 9 am. */
export function deferChoices(now: Date): DeferChoice[] {
  const at = (days: number, h: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, h);
  const out: Omit<DeferChoice, 'key'>[] = [{ label: '1 hour', at: new Date(now.getTime() + 3600_000) }];
  if (now.getHours() < 16) out.push({ label: 'This evening', at: at(0, 18) });
  const tomorrow = (now.getDay() + 1) % 7;
  if (tomorrow >= 1 && tomorrow <= 5) out.push({ label: 'Tomorrow 9 am', at: at(1, 9) });
  if (tomorrow !== 1) out.push({ label: 'Monday 9 am', at: at(((8 - now.getDay()) % 7) || 7, 9) });
  return out.map((c, i) => ({ ...c, key: String(i + 1) }));
}

export function splitTop<T>(items: T[], n: number, all = false): { shown: T[]; more: number } {
  return all || items.length <= n ? { shown: items, more: 0 } : { shown: items.slice(0, n), more: items.length - n };
}

/** Keeps the owner's cursor on the same ask when the order changes; else the ask now at the nearest rank. */
export function keepCursor(prev: string | null, items: Pick<AskItem, 'key'>[], prevIndex: number): string | null {
  if (items.length === 0) return null;
  if (prev && items.some((i) => i.key === prev)) return prev;
  return items[Math.min(Math.max(prevIndex, 0), items.length - 1)].key;
}

/** Asks that arrived from elsewhere: not in the previous list, not caused by this page. Nothing on first load. */
export function newKeys(prev: string[] | null, next: Pick<AskItem, 'key'>[], own: Set<string>): string[] {
  if (prev === null) return [];
  return next.map((i) => i.key).filter((k) => !prev.includes(k) && !own.has(k));
}

export const pageTitle = (open: number): string => (open > 0 ? `(${open}) Stack` : 'Stack');

export function freshness(iso: string | undefined, now: Date): string {
  if (!iso) return 'never';
  const s = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
