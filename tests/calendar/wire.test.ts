import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { calendarFixture } from '../../src/cli/web';

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
