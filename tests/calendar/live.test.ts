import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { calendarSource } from '../../src/cli/web';
import { FileTokenCache } from '../../src/graph/auth';

// @req FR:graph-signin/web.calendar
describe('stack web calendar source', () => {
  const tok = { version: 1 as const, tenant: 'organizations', clientId: '11111111-2222-3333-4444-555555555555', refreshToken: 'rt', accessToken: 'at', expiresAt: Date.now() + 3600_000 };
  it('fixture wins; Graph when signed in with Calendars.Read; nothing otherwise', async () => {
    const d = mkdtempSync(join(tmpdir(), 'cal-src-'));
    const cachePath = join(d, 'graph-token.json');
    expect(await calendarSource({ cachePath })).toEqual({ source: 'none' });
    await new FileTokenCache(cachePath).write({ ...tok, scopes: ['Mail.Read', 'offline_access'] });
    expect((await calendarSource({ cachePath })).source).toBe('none');
    await new FileTokenCache(cachePath).write({ ...tok, scopes: ['Calendars.Read', 'offline_access'] });
    const g = await calendarSource({ cachePath });
    expect(g.source).toBe('graph');
    expect(g.provider).toBeDefined();
    await new FileTokenCache(cachePath).write({ ...tok, scopes: ['https://graph.microsoft.com/calendars.read', 'offline_access'] });
    expect((await calendarSource({ cachePath })).source).toBe('graph');
    const logs: string[] = [];
    await calendarSource({ cachePath, log: (l) => logs.push(l) });
    const fx = join(d, 'events.json');
    writeFileSync(fx, '[]');
    expect((await calendarSource({ cachePath, fixture: fx, log: (l) => logs.push(l) })).source).toBe('fixture');
    await calendarSource({ cachePath: join(d, 'none.json'), log: (l) => logs.push(l) });
    expect(logs).toEqual(['calendar: Graph', 'calendar: fixture']);
    expect(logs.join(' ')).not.toMatch(/\bat\b|\brt\b/);
  });
});
