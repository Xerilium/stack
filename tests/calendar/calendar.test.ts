import { createCalendarGuard, createGraphCalendar, fixtureCalendar, CALENDAR_SCOPES, type CalendarEvent } from '../../src/calendar';
import { GraphDenied, type GraphRequest } from '../../src/email/guard';

const G = 'https://graph.microsoft.com/v1.0';
const ev = (id: string, start: string, end: string, over: Partial<CalendarEvent> = {}): CalendarEvent => ({ id, subject: id, start, end, allDay: false, showAs: 'busy', cancelled: false, online: false, ...over });

// @req FR:day-inputs/cal.model @req FR:day-inputs/cal.fixture
describe('fixture calendar', () => {
  it('returns copies of events overlapping the range, sorted by start', async () => {
    const list = [ev('b', '2026-10-28T15:00:00Z', '2026-10-28T16:00:00Z'), ev('a', '2026-10-28T08:30:00Z', '2026-10-28T09:30:00Z'), ev('x', '2026-10-27T10:00:00Z', '2026-10-27T11:00:00Z'), ev('edge', '2026-10-29T00:00:00Z', '2026-10-29T01:00:00Z')];
    const cal = fixtureCalendar(list);
    const got = await cal.events('2026-10-28T09:00:00Z', '2026-10-29T00:00:00Z');
    expect(got.map((e) => e.id)).toEqual(['a', 'b']);
    got[0].subject = 'changed';
    expect(list[1].subject).toBe('a');
  });
});

// @req FR:day-inputs/cal.guard
describe('calendar guard', () => {
  const g = createCalendarGuard();
  const ok = (url: string) => expect(() => g.check({ method: 'GET', url })).not.toThrow();
  const no = (req: GraphRequest) => expect(() => g.check(req)).toThrow(GraphDenied);
  it('allows only calendarView reads with known query keys', () => {
    ok(`${G}/me/calendarView?startDateTime=2026-10-28T00:00:00Z&endDateTime=2026-10-29T00:00:00Z&$top=100&$orderby=start/dateTime&$select=subject,start`);
    ok(`${G}/me/calendars/AAMk-1=/calendarView?startDateTime=a&endDateTime=b&$skiptoken=x`);
    no({ method: 'POST', url: `${G}/me/calendarView` });
    no({ method: 'GET', url: `${G}/me/events` });
    no({ method: 'GET', url: `${G}/me/calendarView?filter=x` });
    no({ method: 'GET', url: `https://evil.test/v1.0/me/calendarView` });
    no({ method: 'GET', url: `${G}/me/messages` });
    no({ method: 'DELETE', url: `${G}/me/calendarView` });
    expect(CALENDAR_SCOPES).toEqual(['Calendars.Read', 'offline_access']);
  });
});

// @req FR:day-inputs/cal.graph
describe('Graph calendar adapter', () => {
  const graphEvent = (id: string, o: Record<string, unknown> = {}) => ({
    id, subject: `S ${id}`, start: { dateTime: '2026-10-28T15:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-28T15:30:00.0000000', timeZone: 'UTC' },
    isAllDay: false, isCancelled: false, isOnlineMeeting: true, showAs: 'busy', organizer: { emailAddress: { name: 'Roland', address: 'r@x.test' } }, webLink: 'https://outlook.office.com/e/1', ...o,
  });
  it('reads calendarView for the range, follows pages, maps events', async () => {
    const seen: GraphRequest[] = [];
    const transport = async (req: GraphRequest) => {
      seen.push(req);
      if (seen.length === 1) return { value: [graphEvent('1')], '@odata.nextLink': `${G}/me/calendarView?startDateTime=a&endDateTime=b&$skiptoken=p2` };
      return { value: [graphEvent('2', { showAs: 'tentative', isOnlineMeeting: false, isCancelled: true, isAllDay: true })] };
    };
    const cal = createGraphCalendar({ transport });
    const got = await cal.events('2026-10-28T00:00:00.000Z', '2026-10-29T00:00:00.000Z');
    expect(seen[0].method).toBe('GET');
    const u = new URL(seen[0].url);
    expect(u.pathname).toBe('/v1.0/me/calendarView');
    expect(u.searchParams.get('startDateTime')).toBe('2026-10-28T00:00:00.000Z');
    expect(u.searchParams.get('$top')).toBe('100');
    expect(got).toEqual([
      { id: '1', subject: 'S 1', start: '2026-10-28T15:00:00.000Z', end: '2026-10-28T15:30:00.000Z', allDay: false, showAs: 'busy', cancelled: false, online: true, organizer: 'Roland', webLink: 'https://outlook.office.com/e/1' },
      expect.objectContaining({ id: '2', showAs: 'tentative', cancelled: true, allDay: true, online: false }),
    ]);
  });
  it('stops after 10 pages, refuses bad pages and unguarded links', async () => {
    let n = 0;
    const loop = createGraphCalendar({ transport: async () => { n++; return { value: [], '@odata.nextLink': `${G}/me/calendarView?startDateTime=a&endDateTime=b&$skiptoken=${n}` }; } });
    await loop.events('2026-10-28T00:00:00Z', '2026-10-29T00:00:00Z');
    expect(n).toBe(10);
    await expect(createGraphCalendar({ transport: async () => ({ nope: 1 }) }).events('2026-10-28T00:00:00Z', '2026-10-29T00:00:00Z')).rejects.toThrow();
    const evil = createGraphCalendar({ transport: async () => ({ value: [], '@odata.nextLink': `${G}/me/messages` }) });
    await expect(evil.events('2026-10-28T00:00:00Z', '2026-10-29T00:00:00Z')).rejects.toThrow(GraphDenied);
  });
  it('maps unknown showAs to unknown', async () => {
    const cal = createGraphCalendar({ transport: async () => ({ value: [graphEvent('1', { showAs: 'weird' })] }) });
    expect((await cal.events('2026-10-28T00:00:00Z', '2026-10-29T00:00:00Z'))[0].showAs).toBe('unknown');
  });
});
