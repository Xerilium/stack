/**
 * Now's second layer: the next meetings and the top asks, split into messages and the rest. Pure.
 * @req FR:cos-view/brief.meetings @req FR:cos-view/brief.messages @req FR:cos-view/brief.actions @req FR:cos-view/brief.meetings.detail
 */
import type { AskItem } from './asks';
import type { Busy } from './meetings';
import { nowMinutes, type Day } from './plan';

export const MAIL_FROM = 'email-triage';
const CARDS = 3, MEETINGS = 2, JOIN_LEAD = 10;

export interface BriefMeeting { title: string; start: number; end: number; now: boolean; /** Minutes until start (0 when on). */ in: number; join?: string; owner?: string; topic?: string }
export interface Brief { meetings: BriefMeeting[]; messages: AskItem[]; moreMessages: number; actions: AskItem[]; moreActions: number }

export function briefOf(o: { asks: AskItem[]; busy: Busy[]; day: Day; now: Date }): Brief {
  const at = nowMinutes(o.now, o.day);
  const open = o.asks.filter((a) => a.state === 'open').sort((a, b) => b.score - a.score);
  const mail = open.filter((a) => a.from === MAIL_FROM), rest = open.filter((a) => a.from !== MAIL_FROM);
  const live = o.busy.filter((b) => b.end > at).sort((a, b) => a.start - b.start);
  const meetings = live.slice(0, MEETINGS).map((b): BriefMeeting => {
    const now = b.start <= at, join = b.events.find((e) => e.joinUrl)?.joinUrl, owner = b.events.find((e) => e.owner)?.owner, topic = b.events.find((e) => e.topic)?.topic;
    return { title: b.titles[0] ?? 'Meeting', ...(owner ? { owner } : {}), ...(topic ? { topic } : {}), start: b.start, end: b.end, now, in: Math.max(0, b.start - at), ...(join && (now || b.start - at <= JOIN_LEAD) ? { join } : {}) };
  });
  return { meetings, messages: mail.slice(0, CARDS), moreMessages: Math.max(0, mail.length - CARDS), actions: rest.slice(0, CARDS), moreActions: Math.max(0, rest.length - CARDS) };
}
