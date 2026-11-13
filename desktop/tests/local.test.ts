import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeConfig } from '../../src/cli/setup';
import type { WebOpts } from '../../src/cli/web';
import { startLocalHost } from '../src/local';

const tmp = () => mkdtempSync(join(tmpdir(), 'stack-desktop-local-'));
function webDir(): string {
  const d = join(tmp(), 'web/dist');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'index.html'), '<!doctype html>');
  return d;
}

describe('startLocalHost', () => {
  // @req FR:first-run-onboarding/host.setup
  it('no repo: serves the setup flow on 127.0.0.1 instead of failing', async () => {
    const home = tmp();
    const h = await startLocalHost({ home, env: {}, deps: { webDir: webDir(), log: () => undefined } });
    try {
      expect(h.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(await (await fetch(`${h.url}/setup`)).json()).toMatchObject({ needed: true, reason: 'no-repo' });
    } finally { await h.close(); }
  });

  // @req FR:first-run-onboarding/host.setup @req FR:first-run-onboarding/step.calendar @req FR:first-run-onboarding/host.live
  it('a saved repo starts startHost on the setup port, with the setup routes and the saved calendar', async () => {
    const home = tmp(); const seen: WebOpts[] = [];
    writeConfig(home, { repo: '/r', ics: 'https://cal.test/a.ics' });
    const h = await startLocalHost({
      home, env: {}, port: 0,
      deps: {
        webDir: webDir(), log: () => undefined,
        resolveRepo: (s) => s, prepareDemo: () => undefined,
        startWeb: async (o) => { seen.push(o); return { url: 'http://localhost:5', close: async () => undefined }; },
      },
    });
    try {
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ ics: 'https://cal.test/a.ics', dir: join(home, '.config/stack/demo') });
      expect(seen[0].setup).toBeDefined();
      expect(h.url).toBe('http://127.0.0.1:5');
    } finally { await h.close(); }
  });

  // @req FR:first-run-onboarding/host.broken
  it('a repo that fails to start falls back to setup with the error', async () => {
    const home = tmp(); writeConfig(home, { repo: '/r' });
    const h = await startLocalHost({ home, env: {}, deps: { webDir: webDir(), log: () => undefined, resolveRepo: () => { throw new Error('clone failed'); } } });
    try {
      expect(await (await fetch(`${h.url}/setup`)).json()).toMatchObject({ reason: 'broken', error: 'clone failed' });
    } finally { await h.close(); }
  });
});
