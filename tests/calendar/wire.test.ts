import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { calendarFixture, icsCalendar } from '../../src/cli/web';
import { ENV, setup } from '../host/helpers';

// @req FR:day-inputs/api.wire
describe('stack web calendar fixture', () => {
  it('is off without STACK_CALENDAR_FIXTURE and reads a JSON array of events when set', async () => {
    expect(calendarFixture(undefined)).toBeUndefined();
    const d = mkdtempSync(join(tmpdir(), 'cal-'));
    const f = join(d, 'events.json');
    writeFileSync(f, JSON.stringify([{ id: 'a', subject: 'Sync', start: '2026-10-28T15:00:00Z', end: '2026-10-28T15:30:00Z', allDay: false, showAs: 'busy', cancelled: false, online: false }]));
    expect((await calendarFixture(f)!.events('2026-10-28T00:00:00Z', '2026-10-29T00:00:00Z')).map((e) => e.subject)).toEqual(['Sync']);
    writeFileSync(f, '{"not":"a list"}');
    expect(() => calendarFixture(f)).toThrow('JSON array');
  });
});

// @req FR:schedule/ics.wire
describe('STACK_CALENDAR_ICS', () => {
  const ICS = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:w1', 'DTSTART:20261028T150000Z', 'DTEND:20261028T153000Z', 'SUMMARY:Feed sync', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const RANGE = '/api/calendar?from=2026-10-28T00:00:00Z&to=2026-10-29T00:00:00Z';

  it('stack web: off when unset or blank; feeds separated by whitespace or commas; bad values refused without the URL', async () => {
    expect(icsCalendar(undefined)).toBeUndefined();
    expect(icsCalendar(' ,\n ')).toBeUndefined();
    const spy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(ICS));
    try {
      const cal = icsCalendar(' https://a.test/secret-1.ics,\nwebcal://b.test/secret-2.ics ');
      expect((await cal!.events('2026-10-28T00:00:00Z', '2026-10-29T00:00:00Z')).map((e) => e.subject)).toEqual(['Feed sync', 'Feed sync']);
      expect(spy.mock.calls.map((c) => String(c[0]))).toEqual(['https://a.test/secret-1.ics', 'https://b.test/secret-2.ics']);
    } finally { spy.mockRestore(); }
    expect(() => icsCalendar('https://a.test/ok.ics http://b.test/secret.ics')).toThrow(/^Calendar feed 2 /);
    expect(() => icsCalendar('http://b.test/secret.ics')).not.toThrow(/secret/);
  });

  it('host: serves the feeds to the owner; never returns or logs the URL', async () => {
    const spy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(ICS));
    try {
      const ok = await setup({ ...ENV, STACK_CALENDAR_ICS: 'webcal://cal.test/secret-feed.ics' });
      const res = await ok.owner(RANGE);
      const text = await res.text();
      expect(JSON.parse(text)).toMatchObject({ configured: true, items: [{ subject: 'Feed sync' }] });
      expect(String(spy.mock.calls[0][0])).toBe('https://cal.test/secret-feed.ics');
      expect(text).not.toContain('secret-feed');
      spy.mockImplementation(async () => new Response('gone', { status: 410 }));
      const down = await setup({ ...ENV, STACK_CALENDAR_ICS: 'https://cal.test/secret-feed.ics' });
      const failed = await (await down.owner(RANGE)).text();
      expect(JSON.parse(failed)).toMatchObject({ configured: true, items: [], error: 'Calendar unavailable' });
      expect([failed, ...down.logs].join('\n')).not.toContain('secret-feed');
      const bad = await setup({ ...ENV, STACK_CALENDAR_ICS: 'http://cal.test/secret-feed.ics' });
      expect(await (await bad.owner(RANGE)).json()).toMatchObject({ configured: false });
      expect(bad.logs.join('\n')).toContain('STACK_CALENDAR_ICS');
      expect(bad.logs.join('\n')).not.toContain('secret-feed');
    } finally { spy.mockRestore(); }
  });
});
