/**
 * The owner's weekly meetings: `.stack/meetings.md`, one bullet per meeting. Read-only; Brief falls back to it when no calendar is signed in.
 * @req FR:cos-view/meet.config
 */
import type { AuxFiles, Storage } from './storage';

export const MEETINGS_PATH = '.stack/meetings.md';

/** One weekly meeting; `days` 0 = Sunday; times are local `HH:mm`; an end before the start crosses midnight. */
export interface MeetingRule { title: string; days: number[]; start: string; end: string; biweekly?: boolean; topic?: string; owner?: string; join?: string }

const DAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const dayOf = (s: string): number => DAY.indexOf(s.slice(0, 3).toLowerCase());

function parseDays(s: string): number[] | null {
  const out = new Set<number>();
  for (const part of s.split('/')) {
    const m = /^([A-Za-z]{3})(?:-([A-Za-z]{3}))?$/.exec(part.trim());
    if (!m) return null;
    const a = dayOf(m[1]), b = m[2] ? dayOf(m[2]) : a;
    if (a < 0 || b < 0) return null;
    for (let d = a; ; d = (d + 1) % 7) { out.add(d); if (d === b) break; }
  }
  return [...out].sort((x, y) => x - y);
}

/** Minutes after midnight; `a`/`p` wins, else 7 to 11 is am and 12 or 1 to 6 is pm. Hours past 12 are 24 h. */
function clock(s: string): { min: number; explicit: boolean } | null {
  const m = /^(\d{1,2})(?::(\d{2}))?([ap])?$/i.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const mi = m[2] ? Number(m[2]) : 0, mark = m[3]?.toLowerCase();
  if (h > 23 || mi > 59) return null;
  if (h > 12) return { min: h * 60 + mi, explicit: true };
  if (mark) h = (h % 12) + (mark === 'p' ? 12 : 0);
  else if (h < 7 || h === 12) h = h === 12 ? 12 : h + 12;
  return { min: h * 60 + mi, explicit: !!mark };
}

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function parseRange(s: string): { start: string; end: string } | null {
  const [a, b, extra] = s.split('-');
  if (!a || !b || extra !== undefined) return null;
  const start = clock(a);
  if (!start) return null;
  const end = clock(b);
  if (!end) return null;
  // No a or p and not after the start: take the pm reading.
  if (!end.explicit && end.min <= start.min && end.min + 720 > start.min && end.min + 720 < 1440) end.min += 720;
  return { start: hhmm(start.min), end: hhmm(end.min) };
}

const HTTPS = /^https:\/\/[^\s]+$/;
const LINE = /^\s*[-*]\s+([A-Za-z/-]+)\s+([0-9:apAP-]+)(\s*\(biweekly\))?\s*:\s*(.+)$/;

/** The valid bullets in file order. Other lines are skipped. @req FR:cos-view/meet.config */
export function parseMeetings(md: string): MeetingRule[] {
  const out: MeetingRule[] = [];
  for (const line of md.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (!m) continue;
    const days = parseDays(m[1]), range = parseRange(m[2]);
    if (!days || !range) continue;
    const [title, ...rest] = m[4].split(';').map((x) => x.trim());
    if (!title) continue;
    const rule: MeetingRule = { title: title.slice(0, 200), days, ...range };
    if (m[3]) rule.biweekly = true;
    for (const p of rest) {
      const kv = /^(topic|owner|join)\s*:\s*(.+)$/i.exec(p);
      if (!kv) continue;
      const v = kv[2].trim().replace(/^`+|`+$/g, '').trim(), k = kv[1].toLowerCase();
      if (k === 'join') { if (HTTPS.test(v)) rule.join = v; } else if (v) rule[k as 'topic' | 'owner'] = v.slice(0, 200);
    }
    out.push(rule);
  }
  return out;
}

const aux = (s: Storage): AuxFiles | null => (typeof (s as Partial<AuxFiles>).readAux === 'function' ? s as unknown as AuxFiles : null);

/** The rules in `.stack/meetings.md`; no file or an unreadable one has none. @req FR:cos-view/meet.api */
export async function readMeetings(storage: Storage): Promise<MeetingRule[]> {
  const a = aux(storage);
  const f = a ? await a.readAux(MEETINGS_PATH).catch(() => null) : null;
  return f ? parseMeetings(f.content) : [];
}
