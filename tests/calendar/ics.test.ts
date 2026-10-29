import { createIcsCalendar, icsUrls, parseIcs } from '../../src/calendar/ics';

const cal = (...lines: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n');
const vevent = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];

// Outlook publishes Windows zone names with the zone defined inline.
const PACIFIC = [
  'BEGIN:VTIMEZONE', 'TZID:Pacific Standard Time',
  'BEGIN:STANDARD', 'DTSTART:16010101T020000', 'TZOFFSETFROM:-0700', 'TZOFFSETTO:-0800', 'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11', 'END:STANDARD',
  'BEGIN:DAYLIGHT', 'DTSTART:16010101T020000', 'TZOFFSETFROM:-0800', 'TZOFFSETTO:-0700', 'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3', 'END:DAYLIGHT',
  'END:VTIMEZONE',
];
const TEAMS = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0';
const OUTLOOK = cal(
  'METHOD:PUBLISH', 'PRODID:Microsoft Exchange Server 2010', ...PACIFIC,
  ...vevent(
    'UID:0400000082', 'SUMMARY:Team sync',
    'DTSTART;TZID=Pacific Standard Time:20261005T090000', 'DTEND;TZID=Pacific Standard Time:20261005T093000',
    'RRULE:FREQ=WEEKLY;UNTIL=20261231T170000Z;INTERVAL=1;BYDAY=MO,WE;WKST=SU',
    'EXDATE;TZID=Pacific Standard Time:20261028T090000',
    'X-MICROSOFT-CDO-BUSYSTATUS:BUSY', `X-MICROSOFT-SKYPETEAMSMEETINGURL:${TEAMS}`,
    'DESCRIPTION:Notes https://example.com/doc\\nJoin: <https://teams.microsoft.com/l/meetup-join/other>',
  ),
  ...vevent(
    'UID:0400000082', 'RECURRENCE-ID;TZID=Pacific Standard Time:20261026T090000', 'SUMMARY:Team sync (moved)',
    'DTSTART;TZID=Pacific Standard Time:20261026T140000', 'DTEND;TZID=Pacific Standard Time:20261026T150000', 'X-MICROSOFT-CDO-BUSYSTATUS:TENTATIVE',
  ),
  ...vevent(
    'UID:zoomy', 'SUMMARY:Vendor call', 'DTSTART;TZID=Pacific Standard Time:20261103T100000', 'DTEND;TZID=Pacific Standard Time:20261103T110000',
    'X-MICROSOFT-CDO-BUSYSTATUS:WORKINGELSEWHERE', 'LOCATION:http://teams.microsoft.com/l/x https://teams.microsoft.com.evil.test/l/x',
    'DESCRIPTION:Agenda https://example.com/a then https://us02web.zoom.us/j/123?pwd=x.',
  ),
);

// @req FR:schedule/ics.parse @req FR:schedule/ics.status @req FR:schedule/ics.join
describe('parseIcs: Outlook feed', () => {
  const got = parseIcs(OUTLOOK, '2026-10-26T00:00:00Z', '2026-11-05T00:00:00Z');
  it('expands the weekly series in the inline Windows zone, across DST, minus EXDATE, with the override in place', () => {
    expect(got.map((e) => [e.subject, e.start, e.end])).toEqual([
      ['Team sync (moved)', '2026-10-26T21:00:00.000Z', '2026-10-26T22:00:00.000Z'],
      ['Team sync', '2026-11-02T17:00:00.000Z', '2026-11-02T17:30:00.000Z'],
      ['Vendor call', '2026-11-03T18:00:00.000Z', '2026-11-03T19:00:00.000Z'],
      ['Team sync', '2026-11-04T17:00:00.000Z', '2026-11-04T17:30:00.000Z'],
    ]);
  });
  it('maps busy status, ids, and join links', () => {
    expect(got[0]).toEqual({ id: '0400000082/2026-10-26T21:00:00.000Z', subject: 'Team sync (moved)', start: '2026-10-26T21:00:00.000Z', end: '2026-10-26T22:00:00.000Z', allDay: false, showAs: 'tentative', cancelled: false, online: false });
    expect(got[1]).toEqual({ id: '0400000082/2026-11-02T17:00:00.000Z', subject: 'Team sync', start: '2026-11-02T17:00:00.000Z', end: '2026-11-02T17:30:00.000Z', allDay: false, showAs: 'busy', cancelled: false, online: true, joinUrl: TEAMS });
    expect(got[2]).toMatchObject({ showAs: 'workingElsewhere', online: true, joinUrl: 'https://us02web.zoom.us/j/123?pwd=x' });
  });
});

// @req FR:schedule/ics.parse @req FR:schedule/ics.status @req FR:schedule/ics.join
describe('parseIcs: Google feed', () => {
  const GOOGLE = cal(
    'PRODID:-//Google Inc//Google Calendar 70.9054//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-TIMEZONE:America/Los_Angeles',
    ...vevent('DTSTART:20261028T170000Z', 'DTEND:20261028T173000Z', 'UID:abc@google.com', 'SUMMARY:Standup', 'STATUS:CONFIRMED', 'TRANSP:OPAQUE',
      'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij', 'DESCRIPTION:Join https://meet.google.com/zzz-zzzz-zzz'),
    ...vevent('DTSTART:20261028T190000Z', 'DTEND:20261028T200000Z', 'UID:lunch@google.com', 'SUMMARY:Lunch', 'TRANSP:TRANSPARENT'),
    ...vevent('DTSTART:20261028T210000Z', 'DTEND:20261028T220000Z', 'UID:gone@google.com', 'SUMMARY:Review', 'STATUS:CANCELLED'),
    ...vevent('DTSTART:20261028T220000Z', 'DTEND:20261028T223000Z', 'UID:maybe@google.com', 'SUMMARY:Canceled: 1:1', 'STATUS:TENTATIVE'),
    // No VTIMEZONE for this IANA zone: read with the platform's zone data.
    ...vevent('DTSTART;TZID=America/New_York:20261028T090000', 'DTEND;TZID=America/New_York:20261028T100000', 'RRULE:FREQ=DAILY;COUNT=2', 'RDATE:20261030T150000Z', 'UID:nyc@google.com', 'SUMMARY:East coast',
      'LOCATION:https://acme.webex.com/meet/pat'),
  );
  it('reads UTC times, TRANSP, STATUS, Meet links, RDATE, and IANA zones without a definition', () => {
    const got = parseIcs(GOOGLE, '2026-10-28T00:00:00Z', '2026-10-29T00:00:00Z');
    expect(got.map((e) => [e.subject, e.start, e.showAs, e.cancelled])).toEqual([
      ['East coast', '2026-10-28T13:00:00.000Z', 'busy', false],
      ['Standup', '2026-10-28T17:00:00.000Z', 'busy', false],
      ['Lunch', '2026-10-28T19:00:00.000Z', 'free', false],
      ['Review', '2026-10-28T21:00:00.000Z', 'busy', true],
      ['Canceled: 1:1', '2026-10-28T22:00:00.000Z', 'tentative', true],
    ]);
    expect(got[0]).toMatchObject({ online: true, joinUrl: 'https://acme.webex.com/meet/pat' });
    expect(got[1]).toMatchObject({ id: 'abc@google.com/2026-10-28T17:00:00.000Z', online: true, joinUrl: 'https://meet.google.com/abc-defg-hij' });
    expect(got[2]).toMatchObject({ online: false });
    expect(got[2].joinUrl).toBeUndefined();
    expect(parseIcs(GOOGLE, '2026-10-29T00:00:00Z', '2026-11-01T00:00:00Z').map((e) => e.start)).toEqual(['2026-10-29T13:00:00.000Z', '2026-10-30T15:00:00.000Z']);
  });
});

// @req FR:schedule/ics.parse @req FR:schedule/ics.status
describe('parseIcs: busy-only, all-day, range, limits', () => {
  it('names hidden events Busy and keeps OOF', () => {
    const t = cal(...vevent('UID:b1', 'DTSTART:20261028T150000Z', 'DTEND:20261028T160000Z', 'X-MICROSOFT-CDO-BUSYSTATUS:OOF'));
    expect(parseIcs(t, '2026-10-28T00:00:00Z', '2026-10-29T00:00:00Z')).toEqual([
      { id: 'b1/2026-10-28T15:00:00.000Z', subject: 'Busy', start: '2026-10-28T15:00:00.000Z', end: '2026-10-28T16:00:00.000Z', allDay: false, showAs: 'oof', cancelled: false, online: false },
    ]);
  });
  it('reads DATE values as all-day UTC dates; a missing DTEND is one day', () => {
    const t = cal(
      ...vevent('UID:h1', 'DTSTART;VALUE=DATE:20261028', 'DTEND;VALUE=DATE:20261030', 'SUMMARY:Offsite', 'X-MICROSOFT-CDO-BUSYSTATUS:FREE'),
      ...vevent('UID:h2', 'DTSTART;VALUE=DATE:20261029', 'SUMMARY:Birthday'),
    );
    expect(parseIcs(t, '2026-10-29T00:00:00Z', '2026-10-30T00:00:00Z').map((e) => [e.subject, e.start, e.end, e.allDay, e.showAs])).toEqual([
      ['Offsite', '2026-10-28T00:00:00.000Z', '2026-10-30T00:00:00.000Z', true, 'free'],
      ['Birthday', '2026-10-29T00:00:00.000Z', '2026-10-30T00:00:00.000Z', true, 'busy'],
    ]);
  });
  it('keeps events overlapping [from, to) only', () => {
    const t = cal(
      ...vevent('UID:before', 'DTSTART:20261028T080000Z', 'DTEND:20261028T090000Z'),
      ...vevent('UID:across', 'DTSTART:20261028T083000Z', 'DTEND:20261028T093000Z'),
      ...vevent('UID:inside', 'DTSTART:20261028T120000Z', 'DTEND:20261028T130000Z'),
      ...vevent('UID:after', 'DTSTART:20261028T170000Z', 'DTEND:20261028T180000Z'),
    );
    expect(parseIcs(t, '2026-10-28T09:00:00Z', '2026-10-28T17:00:00Z').map((e) => e.id.split('/')[0])).toEqual(['across', 'inside']);
  });
  it('expands years-old series quickly and in step with the rule', () => {
    const t = cal(...PACIFIC,
      ...vevent('UID:old', 'DTSTART;TZID=Pacific Standard Time:20160105T090000', 'DTEND;TZID=Pacific Standard Time:20160105T100000',
        'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', 'EXDATE;TZID=Pacific Standard Time:20261110T090000'),
      ...Array.from({ length: 60 }, (_, i) => vevent(`UID:daily${i}`, 'DTSTART:20100104T170000Z', 'DTEND:20100104T173000Z', 'RRULE:FREQ=DAILY')).flat(),
    );
    const t0 = Date.now();
    const got = parseIcs(t, '2026-10-20T00:00:00Z', '2026-11-25T00:00:00Z');
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(got.filter((e) => e.id.startsWith('old/')).map((e) => e.start)).toEqual(['2026-10-27T16:00:00.000Z', '2026-11-24T17:00:00.000Z']);
    expect(got.filter((e) => e.id.startsWith('daily0/'))).toHaveLength(36);
  });
  it('stops at 2000 occurrences per feed', () => {
    const t = cal(...vevent('UID:m', 'DTSTART:20261028T000000Z', 'DTEND:20261028T000100Z', 'RRULE:FREQ=MINUTELY'));
    expect(parseIcs(t, '2026-10-28T00:00:00Z', '2026-10-31T00:00:00Z')).toHaveLength(2000);
  });
  it('throws on text that is not a calendar', () => {
    expect(() => parseIcs('<html><body>Sign in</body></html>', '2026-10-28T00:00:00Z', '2026-10-29T00:00:00Z')).toThrow('Not a calendar');
    expect(() => parseIcs('BEGIN:VCARD\r\nVERSION:4.0\r\nEND:VCARD', '2026-10-28T00:00:00Z', '2026-10-29T00:00:00Z')).toThrow('Not a calendar');
    expect(() => parseIcs('', '2026-10-28T00:00:00Z', '2026-10-29T00:00:00Z')).toThrow('Not a calendar');
  });
});

// @req FR:schedule/ics.provider
describe('createIcsCalendar', () => {
  const FROM = '2026-10-28T00:00:00Z', TO = '2026-10-29T00:00:00Z';
  const feed = (uid: string, hour: string) => cal(...vevent(`UID:${uid}`, `DTSTART:20261028T${hour}0000Z`, `DTEND:20261028T${hour}3000Z`, `SUMMARY:${uid}`));
  const ok = (body: string | ReadableStream, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/calendar' }, ...init });
  type Call = { url: string; init: RequestInit };
  const fake = (routes: Record<string, () => Response | Promise<Response>>) => {
    const calls: Call[] = [];
    const fetch = (async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      const r = routes[String(url)];
      if (!r) throw new TypeError(`fetch failed ${String(url)}`);
      return r();
    }) as typeof globalThis.fetch;
    return { calls, fetch };
  };

  it('fetches without credentials, merges and sorts feeds, maps webcal to https', async () => {
    const f = fake({ 'https://a.test/secret-a.ics': () => ok(feed('late', '15')), 'https://b.test/secret-b.ics': () => ok(feed('early', '09')) });
    const c = createIcsCalendar({ urls: ['https://a.test/secret-a.ics', 'webcal://b.test/secret-b.ics'], fetch: f.fetch });
    expect((await c.events(FROM, TO)).map((e) => e.subject)).toEqual(['early', 'late']);
    expect(f.calls.map((x) => x.url)).toEqual(['https://a.test/secret-a.ics', 'https://b.test/secret-b.ics']);
    for (const { init } of f.calls) {
      expect(init.credentials).toBe('omit');
      expect(init.redirect).toBe('manual');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('caches each feed for ttlMs', async () => {
    let t = 0;
    const f = fake({ 'https://a.test/x.ics': () => ok(feed('x', '10')) });
    const c = createIcsCalendar({ urls: ['https://a.test/x.ics'], fetch: f.fetch, now: () => t, ttlMs: 1000 });
    await c.events(FROM, TO);
    t = 999;
    await c.events(FROM, TO);
    expect(f.calls).toHaveLength(1);
    t = 1000;
    await c.events(FROM, TO);
    expect(f.calls).toHaveLength(2);
    const d = createIcsCalendar({ urls: ['https://a.test/x.ics'], fetch: f.fetch, now: () => t });
    await d.events(FROM, TO);
    t += 299_999;
    await d.events(FROM, TO);
    expect(f.calls).toHaveLength(3);
  });

  it('refuses anything but https and webcal at creation, without echoing the URL', () => {
    for (const u of ['http://a.test/secret.ics', 'ftp://a.test/secret.ics', 'secret nonsense', 'https://me:secret@a.test/x.ics']) {
      let msg = '';
      try { createIcsCalendar({ urls: [u] }); } catch (e) { msg = (e as Error).message; }
      expect(msg).toMatch(/feed 1/);
      expect(msg).not.toContain('secret');
    }
    expect(() => createIcsCalendar({ urls: [] })).toThrow('No calendar feeds');
  });

  it('skips a failed feed and throws without URLs when every feed fails', async () => {
    const f = fake({
      'https://a.test/secret-a.ics': () => ok(feed('a', '10')),
      'https://b.test/secret-b.ics': () => new Response('nope', { status: 404 }),
      'https://c.test/secret-c.ics': () => ok('<html>Sign in</html>'),
    });
    const c = createIcsCalendar({ urls: ['https://a.test/secret-a.ics', 'https://b.test/secret-b.ics', 'https://c.test/secret-c.ics', 'https://d.test/secret-d.ics'], fetch: f.fetch });
    expect((await c.events(FROM, TO)).map((e) => e.subject)).toEqual(['a']);
    const all = createIcsCalendar({ urls: ['https://b.test/secret-b.ics', 'https://d.test/secret-d.ics'], fetch: f.fetch });
    const err = await all.events(FROM, TO).then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/calendar feeds failed/i);
    expect(err?.message).not.toContain('secret');
    expect(err?.message).not.toContain('.test');
  });

  it('refuses bodies over 5 MB, declared or streamed', async () => {
    const mb = new Uint8Array(1024 * 1024).fill(65);
    const stream = () => new ReadableStream<Uint8Array>({ start(ctl) { for (let i = 0; i < 6; i++) ctl.enqueue(mb); ctl.close(); } });
    const f = fake({
      'https://a.test/declared.ics': () => ok('x', { headers: { 'content-length': String(6 * 1024 * 1024) } }),
      'https://a.test/streamed.ics': () => ok(stream()),
    });
    for (const u of ['https://a.test/declared.ics', 'https://a.test/streamed.ics']) {
      await expect(createIcsCalendar({ urls: [u], fetch: f.fetch }).events(FROM, TO)).rejects.toThrow('too large');
    }
  });

  it('follows https redirects and refuses others', async () => {
    const to = (location: string) => () => new Response(null, { status: 302, headers: { location } });
    const f = fake({
      'https://a.test/x.ics': to('https://cdn.test/x.ics'),
      'https://cdn.test/x.ics': () => ok(feed('moved', '10')),
      'https://a.test/y.ics': to('http://cdn.test/y.ics'),
      'https://a.test/loop.ics': to('/loop.ics'),
    });
    expect((await createIcsCalendar({ urls: ['https://a.test/x.ics'], fetch: f.fetch }).events(FROM, TO)).map((e) => e.subject)).toEqual(['moved']);
    await expect(createIcsCalendar({ urls: ['https://a.test/y.ics'], fetch: f.fetch }).events(FROM, TO)).rejects.toThrow('redirect');
    expect(f.calls.map((c) => c.url)).not.toContain('http://cdn.test/y.ics');
    await expect(createIcsCalendar({ urls: ['https://a.test/loop.ics'], fetch: f.fetch }).events(FROM, TO)).rejects.toThrow('redirect');
  });

  it('times out after 10 seconds', async () => {
    jest.useFakeTimers();
    try {
      const fetch = ((_u: string, init: RequestInit) => new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })) as unknown as typeof globalThis.fetch;
      const p = createIcsCalendar({ urls: ['https://a.test/slow.ics'], fetch }).events(FROM, TO).then(() => null, (e: Error) => e);
      await jest.advanceTimersByTimeAsync(9_999);
      await jest.advanceTimersByTimeAsync(1);
      expect((await p)?.message).toMatch(/timed out/);
    } finally {
      jest.useRealTimers();
    }
  });
});

// @req FR:schedule/ics.wire
describe('icsUrls', () => {
  it('splits on whitespace and commas', () => {
    expect(icsUrls(' https://a.test/1.ics,webcal://b.test/2.ics\n https://c.test/3.ics , ')).toEqual(['https://a.test/1.ics', 'webcal://b.test/2.ics', 'https://c.test/3.ics']);
    expect(icsUrls(undefined)).toEqual([]);
    expect(icsUrls('  ,\n')).toEqual([]);
  });
});
