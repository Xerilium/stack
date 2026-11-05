/**
 * Brief = the Chief of Staff view: next meetings, top messages, top actions, one task, next 90 minutes. Pure.
 * @req FR:cos-view/brief.meetings @req FR:cos-view/brief.messages @req FR:cos-view/brief.actions @req FR:cos-view/brief.ninety
 */
import type { AskItem } from './asks';
import type { HomeItem } from './home';
import type { Busy } from './meetings';
import { nowMinutes, type Day } from './plan';

export const MAIL_FROM = 'email-triage';
const CARDS = 3, MEETINGS = 2, WINDOW = 90, MIN_GAP = 15, JOIN_LEAD = 10;

export interface BriefMeeting { title: string; start: number; end: number; now: boolean; /** Minutes until start (0 when on). */ in: number; join?: string }
export interface Slot { kind: 'meeting' | 'free'; start: number; end: number; title?: string; /** The one task suggested for this gap. */ task?: boolean }
export interface Brief { meetings: BriefMeeting[]; messages: AskItem[]; moreMessages: number; actions: AskItem[]; moreActions: number; one: HomeItem | null; ninety: Slot[] }

export function briefOf(o: { asks: AskItem[]; busy: Busy[]; day: Day; now: Date; one: HomeItem | null }): Brief {
  const at = nowMinutes(o.now, o.day);
  const open = o.asks.filter((a) => a.state === 'open').sort((a, b) => b.score - a.score);
  const mail = open.filter((a) => a.from === MAIL_FROM), rest = open.filter((a) => a.from !== MAIL_FROM);
  const live = o.busy.filter((b) => b.end > at).sort((a, b) => a.start - b.start);
  const meetings = live.slice(0, MEETINGS).map((b): BriefMeeting => {
    const now = b.start <= at, join = b.events.find((e) => e.joinUrl)?.joinUrl;
    return { title: b.titles[0] ?? 'Meeting', start: b.start, end: b.end, now, in: Math.max(0, b.start - at), ...(join && (now || b.start - at <= JOIN_LEAD) ? { join } : {}) };
  });
  // The strip: now to +90 min or bed. Gaps under 15 min are dropped.
  const to = Math.min(at + WINDOW, o.day.end), ninety: Slot[] = [];
  let cur = at;
  const gap = (end: number) => { if (end - cur >= MIN_GAP) ninety.push({ kind: 'free', start: cur, end }); };
  for (const b of live) {
    if (b.start >= to) break;
    if (b.start > cur) gap(b.start);
    ninety.push({ kind: 'meeting', start: Math.max(b.start, at), end: Math.min(b.end, to), title: b.titles[0] ?? 'Meeting' });
    cur = Math.max(cur, Math.min(b.end, to));
  }
  if (cur < to) gap(to);
  if (o.one) { const g = ninety.find((s) => s.kind === 'free' && s.end - s.start >= o.one!.minutes); if (g) g.task = true; }
  return { meetings, messages: mail.slice(0, CARDS), moreMessages: Math.max(0, mail.length - CARDS), actions: rest.slice(0, CARDS), moreActions: Math.max(0, rest.length - CARDS), one: o.one, ninety };
}
