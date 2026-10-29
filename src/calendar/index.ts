/**
 * Calendar module: read-only events for the day plan. Graph behind its own allowlist; fixtures for tests and demo.
 * @req FR:day-inputs/cal.model @req FR:day-inputs/cal.fixture @req FR:day-inputs/cal.guard @req FR:day-inputs/cal.graph
 */
import { GRAPH_BASE, GraphDenied, type GraphGuard, type GraphRequest, type Transport } from '../email/guard';

export const SHOW_AS = ['free', 'tentative', 'busy', 'oof', 'workingElsewhere', 'unknown'] as const;
export type ShowAs = (typeof SHOW_AS)[number];

/** One event; times are UTC ISO date-times. @req FR:day-inputs/cal.model */
export interface CalendarEvent {
  id: string; subject: string; start: string; end: string; allDay: boolean; showAs: ShowAs; cancelled: boolean; online: boolean;
  organizer?: string; webLink?: string;
  /** The online meeting's join link (Teams), when there is one. */
  joinUrl?: string;
}
export interface CalendarProvider { events(from: string, to: string): Promise<CalendarEvent[]> }

const overlaps = (e: CalendarEvent, from: number, to: number) => Date.parse(e.end) > from && Date.parse(e.start) < to;
const byStart = (a: CalendarEvent, b: CalendarEvent) => Date.parse(a.start) - Date.parse(b.start);

/** A provider over a fixed list. @req FR:day-inputs/cal.fixture */
export function fixtureCalendar(list: CalendarEvent[]): CalendarProvider {
  return {
    async events(from, to) {
      const f = Date.parse(from), t = Date.parse(to);
      return list.filter((e) => overlaps(e, f, t)).map((e) => ({ ...e })).sort(byStart);
    },
  };
}

/** Read scope only; the calendar is never written. */
export const CALENDAR_SCOPES = ['Calendars.Read', 'offline_access'] as const;
// Outlook calendar next links page with `$skip`; `$skiptoken` is accepted too.
const KEYS = new Set(['startDateTime', 'endDateTime', '$select', '$top', '$orderby', '$skip', '$skiptoken']);
const VIEW = /^\/me(?:\/calendars\/[A-Za-z0-9_=-]{1,512})?\/calendarView$/;

/** `GET calendarView` and nothing else. @req FR:day-inputs/cal.guard */
export function createCalendarGuard(): GraphGuard {
  const deny = (req: GraphRequest, why: string): never => { throw new GraphDenied(String(req?.method), String(req?.url), why); };
  function check(req: GraphRequest): void {
    if (!req || typeof req.url !== 'string' || typeof req.method !== 'string') return deny(req, 'malformed');
    if (req.method.toUpperCase() !== 'GET') return deny(req, 'read only');
    if (!req.url.startsWith(`${GRAPH_BASE}/`)) return deny(req, 'not the Graph v1.0 endpoint');
    let u: URL;
    try { u = new URL(req.url); } catch { return deny(req, 'bad url'); }
    if (u.origin !== 'https://graph.microsoft.com' || u.username || u.password || u.hash) return deny(req, 'bad url');
    if (!VIEW.test(u.pathname.slice('/v1.0'.length))) return deny(req, 'not calendarView');
    for (const k of u.searchParams.keys()) if (!KEYS.has(k)) return deny(req, `query ${k}`);
  }
  return { check, call: async (req, transport) => { check(req); return transport(req) as never; } };
}

interface GraphEvent {
  id?: unknown; subject?: unknown; start?: { dateTime?: unknown }; end?: { dateTime?: unknown }; isAllDay?: unknown; isCancelled?: unknown;
  isOnlineMeeting?: unknown; showAs?: unknown; organizer?: { emailAddress?: { name?: unknown } }; webLink?: unknown; onlineMeeting?: { joinUrl?: unknown } | null;
}
const SELECT = 'id,subject,start,end,isAllDay,isCancelled,isOnlineMeeting,onlineMeeting,showAs,organizer,webLink';
const MAX_PAGES = 10;
/** Graph returns `2026-10-28T15:00:00.0000000` in the requested zone (UTC by default). */
const utc = (v: unknown): string => {
  const s = typeof v === 'string' ? v : '';
  const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s.replace(/(\.\d{3})\d*$/, '$1')}Z`);
  if (!Number.isFinite(d.getTime())) throw new Error('Bad event time');
  return d.toISOString();
};
const str = (v: unknown) => (typeof v === 'string' ? v : '');

function toEvent(g: GraphEvent): CalendarEvent {
  const showAs = (SHOW_AS as readonly string[]).includes(str(g.showAs)) ? (g.showAs as ShowAs) : 'unknown';
  const organizer = str(g.organizer?.emailAddress?.name);
  const webLink = str(g.webLink);
  const joinUrl = str(g.onlineMeeting?.joinUrl);
  return {
    id: str(g.id), subject: str(g.subject), start: utc(g.start?.dateTime), end: utc(g.end?.dateTime), allDay: g.isAllDay === true, showAs,
    cancelled: g.isCancelled === true, online: g.isOnlineMeeting === true, ...(organizer ? { organizer } : {}), ...(webLink.startsWith('https://') ? { webLink } : {}), ...(joinUrl.startsWith('https://') ? { joinUrl } : {}),
  };
}

/** Reads `calendarView` for a range through the guard. @req FR:day-inputs/cal.graph */
export function createGraphCalendar(o: { transport: Transport; guard?: GraphGuard }): CalendarProvider {
  const guard = o.guard ?? createCalendarGuard();
  return {
    async events(from, to) {
      const q = new URLSearchParams({ startDateTime: from, endDateTime: to, $top: '100', $orderby: 'start/dateTime', $select: SELECT });
      let url: string | undefined = `${GRAPH_BASE}/me/calendarView?${q.toString()}`;
      const out: CalendarEvent[] = [];
      for (let page = 0; url && page < MAX_PAGES; page++) {
        const body = (await guard.call({ method: 'GET', url }, o.transport)) as { value?: unknown; '@odata.nextLink'?: unknown };
        if (!body || typeof body !== 'object' || !Array.isArray(body.value)) throw new Error('Bad calendar page');
        out.push(...(body.value as GraphEvent[]).map(toEvent));
        url = typeof body['@odata.nextLink'] === 'string' ? body['@odata.nextLink'] : undefined;
        if (url) guard.check({ method: 'GET', url });
      }
      return out.sort(byStart);
    },
  };
}
