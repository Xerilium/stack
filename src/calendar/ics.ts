/**
 * ICS calendar feeds: the published links Outlook and Google give out. Read-only; the feed URL is a secret.
 * @req FR:schedule/ics.parse @req FR:schedule/ics.status @req FR:schedule/ics.join @req FR:schedule/ics.provider @req FR:schedule/ics.wire
 */
import ICAL from 'ical.js';
import type { CalendarEvent, CalendarProvider, ShowAs } from './index';

type Component = InstanceType<typeof ICAL.Component>;
type Time = InstanceType<typeof ICAL.Time>;

/** Errors from this module never hold a feed URL. */
export class IcsError extends Error {
  constructor(message: string) { super(message); this.name = 'IcsError'; }
}

const MAX_OCCURRENCES = 2000;
/** Series are walked from their first occurrence; this bounds the work per feed. */
const MAX_STEPS = 50_000;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const DAY_MS = 864e5;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byStart = (a: CalendarEvent, b: CalendarEvent) => cmp(a.start, b.start) || cmp(a.id, b.id);
const prop = (c: Component, name: string): string => { const v = c.getFirstPropertyValue(name); return typeof v === 'string' ? v.trim() : ''; };
const tzidOf = (c: Component, name: string): string | undefined => { const v = c.getFirstProperty(name)?.getParameter('tzid'); return typeof v === 'string' ? v : undefined; };

const ianaZones = new Map<string, Intl.DateTimeFormat | null>();
function iana(tz: string): Intl.DateTimeFormat | null {
  if (!ianaZones.has(tz)) {
    let f: Intl.DateTimeFormat | null = null;
    try { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { /* not an IANA zone */ }
    ianaZones.set(tz, f);
  }
  return ianaZones.get(tz)!;
}
const offsetMs = (f: Intl.DateTimeFormat, ms: number) => {
  const p = f.formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - ms;
};

/**
 * Epoch ms of a feed time. Zones the feed defines (Outlook's Windows names included) and UTC go through ical.js;
 * a TZID the feed does not define is read as an IANA zone when it is one, else as UTC.
 * DATE values (all-day) are UTC midnights, as Graph returns them.
 */
function instant(t: Time, tzid: string | undefined): number {
  const f = !t.isDate && tzid && t.zone === ICAL.Timezone.localTimezone ? iana(tzid) : null;
  if (!f) return t.toUnixTime() * 1000;
  const wall = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  return wall - offsetMs(f, wall - offsetMs(f, wall));
}

const BUSY = new Map<string, ShowAs>([['FREE', 'free'], ['TENTATIVE', 'tentative'], ['BUSY', 'busy'], ['OOF', 'oof'], ['WORKINGELSEWHERE', 'workingElsewhere']]);
/** @req FR:schedule/ics.status */
function showAs(c: Component): ShowAs {
  const cdo = BUSY.get(prop(c, 'x-microsoft-cdo-busystatus').toUpperCase());
  if (cdo) return cdo;
  if (prop(c, 'transp').toUpperCase() === 'TRANSPARENT') return 'free';
  return prop(c, 'status').toUpperCase() === 'TENTATIVE' ? 'tentative' : 'busy';
}

const JOIN_FROM = ['x-microsoft-skypeteamsmeetingurl', 'x-google-conference', 'url', 'location', 'description'];
const LINK = /https:\/\/[^\s<>"'()[\]{}]+/gi;
const joinHost = (h: string) => h === 'teams.microsoft.com' || h === 'teams.live.com' || h === 'meet.google.com'
  || h === 'zoom.us' || h.endsWith('.zoom.us') || h === 'webex.com' || h.endsWith('.webex.com');
/** The first meeting link, in property order. @req FR:schedule/ics.join */
function joinUrl(c: Component): string | undefined {
  for (const name of JOIN_FROM) {
    for (const p of c.getAllProperties(name)) {
      const v = p.getFirstValue();
      for (const m of typeof v === 'string' ? v.match(LINK) ?? [] : []) {
        const s = m.replace(/[.,;:!?]+$/, '');
        try {
          const u = new URL(s);
          if (u.protocol === 'https:' && !u.username && !u.password && !u.port && joinHost(u.hostname)) return s;
        } catch { /* not a link */ }
      }
    }
  }
  return undefined;
}

/** @req FR:schedule/ics.status @req FR:schedule/ics.join */
function toEvent(c: Component, uid: string, start: number, end: number, allDay: boolean): CalendarEvent {
  const s = new Date(start).toISOString();
  const summary = prop(c, 'summary');
  const join = joinUrl(c);
  return {
    id: `${uid}/${s}`, subject: summary || 'Busy', start: s, end: new Date(Math.max(start, end)).toISOString(), allDay, showAs: showAs(c),
    cancelled: prop(c, 'status').toUpperCase() === 'CANCELLED' || /^cancell?ed:/i.test(summary), online: !!join, ...(join ? { joinUrl: join } : {}),
  };
}

/**
 * Where to start walking a daily or weekly series with one RRULE and no COUNT: whole periods after DTSTART and over a day
 * before the range, so weekday and interval stay aligned and the start itself falls outside the range. Others start at DTSTART.
 */
function startNear(c: Component, start: Time, first: number, length: number, from: number): Time | undefined {
  const rules = c.getAllProperties('rrule');
  if (rules.length !== 1) return undefined;
  const r = rules[0].getFirstValue() as InstanceType<typeof ICAL.Recur>;
  const days = r.freq === 'DAILY' ? 1 : r.freq === 'WEEKLY' ? 7 : 0;
  if (!days || r.count) return undefined;
  const period = days * (r.interval || 1);
  const k = Math.floor((from - first - length - 2 * DAY_MS) / DAY_MS / period);
  if (k <= 0) return undefined;
  return start.clone().adjust(k * period, 0, 0, 0);
}

function readCalendar(text: string): Component {
  const s = typeof text === 'string' ? text.replace(/^﻿/, '').trimStart() : '';
  if (!/^BEGIN:VCALENDAR\r?\n/i.test(s)) throw new IcsError('Not a calendar');
  let jcal: unknown;
  try { jcal = ICAL.parse(s); } catch { throw new IcsError('Not a calendar: unreadable'); }
  if (Array.isArray(jcal) && Array.isArray(jcal[0])) jcal = jcal[0];
  const root = new ICAL.Component(jcal as unknown[]);
  if (root.name !== 'vcalendar') throw new IcsError('Not a calendar');
  return root;
}

/**
 * Events of a VCALENDAR overlapping `[from, to)`, sorted by start: series expanded (RRULE, RDATE, minus EXDATE),
 * RECURRENCE-ID overrides in place of their occurrence. At most 2000 occurrences.
 * @req FR:schedule/ics.parse
 */
export function parseIcs(text: string, from: string, to: string): CalendarEvent[] {
  const f = Date.parse(from), t = Date.parse(to);
  if (!Number.isFinite(f) || !Number.isFinite(t)) throw new IcsError('Bad range');
  const root = readCalendar(text);
  const out: CalendarEvent[] = [];
  let steps = MAX_STEPS;
  const emit = (c: Component, uid: string, s: number, e: number, allDay: boolean) => { if (e > f && s < t) out.push(toEvent(c, uid, s, e, allDay)); };

  const vevents = root.getAllSubcomponents('vevent');
  // Overrides stand on their own; their recurrence ids are left out of the series.
  const overridden = new Map<string, Set<number>>();
  const masters: { c: Component; uid: string }[] = [];
  vevents.forEach((c, i) => {
    const uid = prop(c, 'uid') || `event-${i}`;
    const rid = c.getFirstPropertyValue('recurrence-id');
    if (!rid) { masters.push({ c, uid }); return; }
    try {
      const ev = new ICAL.Event(c);
      const ids = overridden.get(uid) ?? new Set<number>();
      ids.add(instant(rid as Time, tzidOf(c, 'recurrence-id')));
      overridden.set(uid, ids);
      emit(c, uid, instant(ev.startDate, tzidOf(c, 'dtstart')), instant(ev.endDate, tzidOf(c, 'dtend') ?? tzidOf(c, 'dtstart')), ev.startDate.isDate);
    } catch { /* malformed event: skip it */ }
  });

  for (const { c, uid } of masters) {
    if (out.length >= MAX_OCCURRENCES || steps <= 0) break;
    try {
      const ev = new ICAL.Event(c);
      const startTz = tzidOf(c, 'dtstart');
      const first = instant(ev.startDate, startTz);
      const length = instant(ev.endDate, tzidOf(c, 'dtend') ?? startTz) - first;
      const allDay = ev.startDate.isDate;
      if (!ev.isRecurring()) { emit(c, uid, first, first + length, allDay); continue; }
      const skip = overridden.get(uid);
      const it = ev.iterator(startNear(c, ev.startDate, first, length, f));
      for (let next = it.next(); next && steps-- > 0 && out.length < MAX_OCCURRENCES; next = it.next()) {
        // Wall-clock time is within a day of the instant: skip zone math far from the range.
        const wall = Date.UTC(next.year, next.month - 1, next.day, next.hour, next.minute, next.second);
        if (wall + length + DAY_MS < f) continue;
        if (wall - DAY_MS >= t) break;
        const s = instant(next, startTz);
        if (s >= t) break;
        if (!skip?.has(s)) emit(c, uid, s, s + length, allDay);
      }
    } catch { /* malformed event: skip it */ }
  }
  return out.slice(0, MAX_OCCURRENCES).sort(byStart);
}

/** Feed URLs from `STACK_CALENDAR_ICS`: separated by whitespace or commas. @req FR:schedule/ics.wire */
export function icsUrls(value: string | undefined): string[] {
  return (value ?? '').split(/[\s,]+/).filter(Boolean);
}

export interface IcsOptions {
  /** `https:` or `webcal:` feed URLs. */
  urls: string[];
  fetch?: typeof globalThis.fetch;
  /** How long a feed's text is reused. Default 5 minutes. */
  ttlMs?: number;
  now?: () => number;
}

function feedUrl(raw: string, n: number): string {
  let u: URL;
  try { u = new URL(String(raw).trim().replace(/^webcal:/i, 'https:')); } catch { throw new IcsError(`Calendar feed ${n} is not a URL`); }
  if (u.protocol !== 'https:') throw new IcsError(`Calendar feed ${n} must be https or webcal`);
  if (u.username || u.password) throw new IcsError(`Calendar feed ${n} must not hold credentials`);
  return u.href;
}

async function readCapped(res: Response): Promise<string> {
  const tooLarge = () => new IcsError('too large');
  if (Number(res.headers.get('content-length')) > MAX_BYTES) { await res.body?.cancel(); throw tooLarge(); }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw tooLarge(); }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return new TextDecoder('utf-8').decode(all);
}

/** One GET: no credentials, 10 s for the whole exchange, https redirects only, 5 MB at most. */
async function download(fetchFn: typeof globalThis.fetch, url: string): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    let at = url;
    for (let hop = 0; ; hop++) {
      const res = await fetchFn(at, { method: 'GET', credentials: 'omit', redirect: 'manual', signal: ctl.signal, headers: { accept: 'text/calendar, */*;q=0.1' } });
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel();
        const loc = res.headers.get('location');
        const next = loc ? new URL(loc, at) : null;
        if (!next || next.protocol !== 'https:' || next.username || next.password || hop >= MAX_REDIRECTS) throw new IcsError('refused redirect');
        at = next.href;
        continue;
      }
      if (!res.ok) throw new IcsError(`HTTP ${res.status}`);
      return await readCapped(res);
    }
  } catch (e) {
    if (e instanceof IcsError) throw e;
    if (ctl.signal.aborted) throw new IcsError('timed out');
    // Foreign errors can hold the URL: keep the class name only.
    throw new IcsError(e instanceof Error ? e.constructor.name : 'network error');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A calendar over published ICS feeds. Each feed's text is cached for `ttlMs`; failed feeds are skipped; the call
 * throws only when every feed fails.
 * @req FR:schedule/ics.provider
 */
export function createIcsCalendar(o: IcsOptions): CalendarProvider {
  if (!Array.isArray(o.urls) || o.urls.length === 0) throw new IcsError('No calendar feeds');
  const urls = o.urls.map((u, i) => feedUrl(u, i + 1));
  const fetchFn = o.fetch ?? globalThis.fetch;
  const ttl = o.ttlMs ?? 300_000;
  const now = o.now ?? Date.now;
  const cache = new Map<string, { at: number; text: string }>();
  const read = async (url: string) => {
    const hit = cache.get(url);
    if (hit && now() - hit.at < ttl) return hit.text;
    const text = await download(fetchFn, url);
    cache.set(url, { at: now(), text });
    return text;
  };
  return {
    async events(from, to) {
      const results = await Promise.allSettled(urls.map(async (u) => parseIcs(await read(u), from, to)));
      const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      if (ok.length === 0) {
        const why = results.map((r, i) => `feed ${i + 1}: ${r.status === 'rejected' && r.reason instanceof IcsError ? r.reason.message : 'error'}`);
        throw new IcsError(`All calendar feeds failed (${why.join('; ')})`);
      }
      return ok.flat().sort(byStart);
    },
  };
}
