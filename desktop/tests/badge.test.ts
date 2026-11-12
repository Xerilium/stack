/** @req FR:pris-sessions-ui/tray.badge @req FR:pris-sessions-ui/tray.fail */
import { needsYouCount } from '../src/badge';
import { createShell } from '../src/shell';
import { fakeElectron } from './fakes';

const URL_ = 'http://127.0.0.1:4242';
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function setup(counts: (number | Error)[]) {
  const e = fakeElectron();
  const log: string[] = [];
  const asked: string[] = [];
  const shell = createShell({
    electron: e, startHost: async () => ({ url: URL_, close: async () => undefined }), assetsDir: '/assets', log: (l) => log.push(l), closeTimeoutMs: 50,
    needsCount: async (url) => { asked.push(url); const c = counts.length > 1 ? counts.shift()! : counts[0]; if (c instanceof Error) throw c; return c; },
  });
  return { e, log, asked, shell, tray: () => e.trays[0] };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('badge', () => {
  // @req FR:pris-sessions-ui/tray.badge
  it('shows the Needs-you count on the dock and the tray at start and every 15 s; 0 clears it', async () => {
    const { e, asked, shell, tray } = setup([3, 0, 1]);
    await shell.start();
    await flush();
    expect(asked).toEqual([URL_]);
    expect(e.badge).toBe(3);
    expect(tray().title).toBe('3');
    expect(tray().tooltip).toBe('Stack · 3 need you');
    await jest.advanceTimersByTimeAsync(15_000);
    expect(e.badge).toBe(0);
    expect(tray().title).toBe('');
    expect(tray().tooltip).toBe('Stack');
    await jest.advanceTimersByTimeAsync(15_000);
    expect(tray().tooltip).toBe('Stack · 1 needs you');
    expect(asked).toHaveLength(3);
  });
  // @req FR:pris-sessions-ui/tray.fail
  it('a failed read keeps the last count and logs once until a read works; quit stops the timer', async () => {
    const { e, log, asked, shell, tray } = setup([2, new Error('down'), new Error('down'), 4]);
    await shell.start();
    await flush();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(e.badge).toBe(2);
    expect(tray().title).toBe('2');
    expect(log.filter((l) => l.startsWith('badge:'))).toEqual(['badge: down']);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(e.badge).toBe(4);
    e.app.quit();
    await shell.stopped();
    const n = asked.length;
    await jest.advanceTimersByTimeAsync(60_000);
    expect(asked).toHaveLength(n);
  });
});

describe('needsYouCount', () => {
  // @req FR:pris-sessions-ui/tray.badge
  it('reads the inventory from the host over loopback and counts needsYou', async () => {
    const urls: string[] = [];
    const ok = async (u: string) => { urls.push(u); return { ok: true, status: 200, json: async () => ({ needsYou: [{}, {}] }) }; };
    expect(await needsYouCount(URL_, ok as never)).toBe(2);
    expect(urls).toEqual([`${URL_}/api/session-inventory`]);
    const notFound = async () => ({ ok: false, status: 404, json: async () => ({}) });
    expect(await needsYouCount(URL_, notFound as never)).toBe(0);
    const broken = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await expect(needsYouCount(URL_, broken as never)).rejects.toThrow('HTTP 500');
  });
});
