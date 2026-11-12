import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'fs';
import { request } from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import { applySetup, createSetup, hasTaskRows, readConfig, runLocal, setupStatus, SIGN_IN, startSetupServer, STEPS, writeConfig } from '../../src/cli/setup';
import { startWeb } from '../../src/cli/web';

const quiet = { watch: { watchFn: (() => ({ on() { return this; }, close() { /* none */ } })) as unknown as typeof import('fs').watch } };
const tmp = () => mkdtempSync(join(tmpdir(), 'stack-setup-'));
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe' });
function gitRepo(tasks: string | null = '# Alpha\n\n## 🔄 Active\n\n- [ ] Ship it\n'): string {
  const d = tmp();
  git(d, 'init', '-q', '-b', 'main');
  if (tasks !== null) { mkdirSync(join(d, 'tasks')); writeFileSync(join(d, 'tasks/alpha.md'), tasks); }
  return d;
}
function webDir(): string {
  const d = join(tmp(), 'dist');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'index.html'), '<!doctype html><div id="app"></div>');
  return d;
}
const post = (url: string, body: unknown, h: Record<string, string> = {}) => fetch(`${url}/setup`, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });

describe('user config', () => {
  // @req FR:first-run-onboarding/state.store
  it('merges writes, keeps other keys, and uses mode 0600', () => {
    const home = tmp();
    writeConfig(home, { repo: '/r', batch: 3 });
    writeConfig(home, { onboarding: { step: 'mode' } });
    expect(readConfig(home)).toEqual({ repo: '/r', batch: 3, onboarding: { step: 'mode' } });
    expect(statSync(join(home, '.config/stack/config.json')).mode & 0o777).toBe(0o600);
    writeConfig(home, { mode: undefined });
    expect(readConfig(home)).not.toHaveProperty('mode');
  });
  it('reads a missing or broken file as empty', () => {
    const home = tmp();
    expect(readConfig(home)).toEqual({});
    mkdirSync(join(home, '.config/stack'), { recursive: true });
    writeFileSync(join(home, '.config/stack/config.json'), '{nope');
    expect(readConfig(home)).toEqual({});
  });
});

describe('hasTaskRows', () => {
  // @req FR:first-run-onboarding/state.needed
  it('is true only when a task file has a checkbox row', () => {
    expect(hasTaskRows(gitRepo())).toBe(true);
    expect(hasTaskRows(gitRepo('# Empty\n'))).toBe(false);
    expect(hasTaskRows(gitRepo(null))).toBe(false);
    expect(hasTaskRows(null)).toBe(false);
  });
});

describe('setupStatus', () => {
  const base = { env: {}, email: false };
  // @req FR:first-run-onboarding/state.needed @req FR:first-run-onboarding/state.status
  it('is needed with no repo, an empty repo, or a flow in progress; never for a full repo', () => {
    expect(setupStatus({ ...base, cfg: {}, dir: null })).toMatchObject({ needed: true, reason: 'no-repo', step: 'repo', steps: STEPS, repo: null, mode: 'demo', calendar: false, email: false, signIn: SIGN_IN });
    const full = gitRepo();
    expect(setupStatus({ ...base, cfg: { repo: full }, dir: full })).toMatchObject({ needed: false, reason: null });
    const empty = gitRepo('# Empty\n');
    expect(setupStatus({ ...base, cfg: { repo: empty }, dir: empty })).toMatchObject({ needed: true, reason: 'empty' });
    expect(setupStatus({ ...base, cfg: { repo: full, onboarding: { step: 'calendar' } }, dir: full })).toMatchObject({ needed: true, reason: 'resume', step: 'calendar' });
    expect(setupStatus({ ...base, cfg: { repo: empty, onboarding: { step: 'phone', done: true } }, dir: empty })).toMatchObject({ needed: false });
  });
  // @req FR:first-run-onboarding/host.broken
  it('a host that failed to start is needed at the repo step with the error, done or not', () => {
    expect(setupStatus({ ...base, cfg: { repo: '/gone', onboarding: { step: 'phone', done: true } }, dir: null, error: 'no such repo' })).toMatchObject({ needed: true, reason: 'broken', step: 'repo', error: 'no such repo' });
  });
  // @req FR:first-run-onboarding/state.status
  it('redacts credentials in the repo url and reports calendar and email', () => {
    const s = setupStatus({ env: { STACK_CALENDAR_ICS: 'https://x.test/a.ics' }, email: true, cfg: { repo: 'https://me:tok@github.com/o/r.git', mode: 'live' }, dir: null });
    expect(s).toMatchObject({ repo: 'https://github.com/o/r.git', mode: 'live', calendar: true, email: true });
    expect(setupStatus({ ...base, cfg: { ics: 'https://x.test/a.ics' }, dir: null }).calendar).toBe(true);
  });
});

describe('applySetup', () => {
  const env = {};
  // @req FR:first-run-onboarding/step.repo
  it('repo: takes a git repo path or a git url; refuses anything else', () => {
    const home = tmp(); const repo = gitRepo();
    expect(applySetup({ home, env, body: { step: 'repo', repo } })).toEqual({ ok: true, restart: true });
    expect(readConfig(home)).toMatchObject({ repo, onboarding: { step: 'mode' } });
    // The same repo again is a confirm: no restart.
    expect(applySetup({ home, env, body: { step: 'repo', repo } })).toEqual({ ok: true, restart: false });
    expect(applySetup({ home: tmp(), env, body: { step: 'repo', repo: 'git@github.com:o/r.git' } })).toEqual({ ok: true, restart: true });
    expect(applySetup({ home, env, body: { step: 'repo', repo: '' } })).toMatchObject({ ok: false, error: expect.stringMatching(/path or a git url/) });
    expect(applySetup({ home, env, body: { step: 'repo', repo: join(home, 'nope') } })).toMatchObject({ ok: false, error: expect.stringMatching(/not found/) });
    expect(applySetup({ home, env, body: { step: 'repo', repo: tmp() } })).toMatchObject({ ok: false, error: expect.stringMatching(/not a git repo/) });
    expect(applySetup({ home, env, body: { step: 'repo', repo: 'ftp://x/y' } })).toMatchObject({ ok: false });
  });
  // @req FR:first-run-onboarding/step.repo
  it('repo: expands ~ to the home folder', () => {
    const home = tmp(); const r = join(home, 'tasks-repo'); mkdirSync(r); git(r, 'init', '-q');
    expect(applySetup({ home, env, body: { step: 'repo', repo: '~/tasks-repo' } })).toMatchObject({ ok: true });
    expect(readConfig(home).repo).toBe(r);
  });
  // @req FR:first-run-onboarding/step.mode
  it('mode: demo by default; live needs the ack and restarts', () => {
    const home = tmp(); const repo = gitRepo();
    applySetup({ home, env, body: { step: 'repo', repo } });
    expect(applySetup({ home, env, body: { step: 'mode', mode: 'demo' } })).toEqual({ ok: true, restart: false });
    expect(readConfig(home)).toMatchObject({ onboarding: { step: 'calendar' } });
    expect(readConfig(home)).not.toHaveProperty('mode');
    expect(applySetup({ home, env, body: { step: 'mode', mode: 'live' } })).toMatchObject({ ok: false, error: expect.stringMatching(/I understand/) });
    expect(applySetup({ home, env, body: { step: 'mode', mode: 'live', ack: true } })).toEqual({ ok: true, restart: true });
    expect(readConfig(home).mode).toBe('live');
    expect(applySetup({ home, env, body: { step: 'mode', mode: 'demo' } })).toEqual({ ok: true, restart: true });
    expect(applySetup({ home, env, body: { step: 'mode', mode: 'wild' } })).toMatchObject({ ok: false });
  });
  // @req FR:first-run-onboarding/step.mode.tasks
  it('mode: a repo with no tasks/ needs Live, which creates the folder', () => {
    const home = tmp(); const repo = gitRepo(null);
    expect(applySetup({ home, env, body: { step: 'repo', repo } })).toEqual({ ok: true, restart: false });
    expect(applySetup({ home, env, body: { step: 'mode', mode: 'demo' } })).toMatchObject({ ok: false, error: expect.stringMatching(/Live/) });
    expect(applySetup({ home, env, body: { step: 'mode', mode: 'live', ack: true } })).toEqual({ ok: true, restart: true });
    expect(existsSync(join(repo, 'tasks'))).toBe(true);
  });
  // @req FR:first-run-onboarding/step.calendar
  it('calendar: an https or webcal link is saved and restarts; skip moves on', () => {
    const home = tmp(); applySetup({ home, env, body: { step: 'repo', repo: gitRepo() } });
    expect(applySetup({ home, env, body: { step: 'calendar', ics: 'http://x.test/a.ics' } })).toMatchObject({ ok: false, error: expect.stringMatching(/https/) });
    expect(applySetup({ home, env, body: { step: 'calendar', ics: 'webcal://x.test/a.ics' } })).toEqual({ ok: true, restart: true });
    expect(readConfig(home)).toMatchObject({ ics: 'webcal://x.test/a.ics', onboarding: { step: 'email' } });
    expect(applySetup({ home, env, body: { step: 'calendar', skip: true } })).toEqual({ ok: true, restart: false });
  });
  // @req FR:first-run-onboarding/step.email @req FR:first-run-onboarding/step.phone @req FR:first-run-onboarding/state.resume
  it('email and phone move on; phone finishes; go returns to an earlier step', () => {
    const home = tmp(); applySetup({ home, env, body: { step: 'repo', repo: gitRepo() } });
    expect(applySetup({ home, env, body: { step: 'email', skip: true } })).toEqual({ ok: true, restart: false });
    expect(readConfig(home).onboarding).toEqual({ step: 'phone' });
    expect(applySetup({ home, env, body: { step: 'phone' } })).toEqual({ ok: true, restart: false });
    expect(readConfig(home).onboarding).toEqual({ step: 'phone', done: true });
    expect(applySetup({ home, env, body: { go: 'mode' } })).toEqual({ ok: true, restart: false });
    expect(readConfig(home).onboarding).toEqual({ step: 'mode' });
  });
  it('refuses unknown steps and later steps before a repo', () => {
    expect(applySetup({ home: tmp(), env, body: { step: 'nope' } })).toMatchObject({ ok: false });
    expect(applySetup({ home: tmp(), env, body: { step: 'mode', mode: 'demo' } })).toMatchObject({ ok: false, error: expect.stringMatching(/repo first/) });
    expect(applySetup({ home: tmp(), env, body: null })).toMatchObject({ ok: false });
  });
  // @req FR:first-run-onboarding/step.max
  it('has at most 5 steps', () => { expect(STEPS.length).toBeLessThanOrEqual(5); });
});

describe('setup server', () => {
  // @req FR:first-run-onboarding/host.setup @req FR:first-run-onboarding/host.apply
  it('serves the app, the setup routes, and the loopback and CSRF guards', async () => {
    const home = tmp(); let restarts = 0;
    const setup = createSetup({ home, env: {}, spec: () => readConfig(home).repo as string | undefined, dir: () => null, restart: () => { restarts++; } });
    const s = await startSetupServer({ port: 0, webDir: webDir(), setup });
    try {
      expect(await (await fetch(s.url)).text()).toContain('app');
      expect(await (await fetch(`${s.url}/.auth/me`)).json()).toMatchObject({ local: null, setup: true, clientPrincipal: { identityProvider: 'local' } });
      expect(await (await fetch(`${s.url}/setup`)).json()).toMatchObject({ needed: true, reason: 'no-repo', step: 'repo' });
      expect((await fetch(`${s.url}/api/tasks`)).status).toBe(404);
      const bad = await post(s.url, { step: 'repo', repo: '' });
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ error: { code: 'invalid' } });
      expect((await post(s.url, { step: 'repo', repo: gitRepo() }, { origin: 'https://evil.example' })).status).toBe(403);
      expect((await post(s.url, { step: 'repo', repo: gitRepo() }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
      const ok = await post(s.url, { step: 'repo', repo: gitRepo() });
      expect(await ok.json()).toMatchObject({ restart: true, status: { step: 'mode' } });
      await new Promise((r) => setTimeout(r, 30));
      expect(restarts).toBe(1);
      const port = new URL(s.url).port;
      const code = await new Promise<number>((ok) => request({ host: '127.0.0.1', port, path: '/setup', headers: { host: 'evil.example' } }, (r) => { r.resume(); ok(r.statusCode ?? 0); }).end());
      expect(code).toBe(403);
    } finally { await s.close(); }
  });

  // @req FR:first-run-onboarding/host.live
  it('the live server answers /setup too', async () => {
    const repo = gitRepo('# Empty\n'); const home = tmp();
    writeConfig(home, { repo });
    const setup = createSetup({ home, env: {}, spec: () => repo, dir: () => repo, restart: () => undefined });
    const s = await startWeb({ dir: repo, port: 0, webDir: webDir(), agents: false, setup, ...quiet });
    try {
      expect(await (await fetch(`${s.url}/setup`)).json()).toMatchObject({ needed: true, reason: 'empty' });
      expect(await (await post(s.url, { step: 'repo', repo })).json()).toMatchObject({ restart: false, status: { step: 'mode' } });
    } finally { await s.close(); }
  });
});

describe('runLocal', () => {
  // @req FR:first-run-onboarding/host.setup @req FR:first-run-onboarding/host.apply
  it('starts the setup server with no repo, then restarts on the same port into the real server', async () => {
    const home = tmp(); const repo = gitRepo(); const started: number[] = [];
    const h = await runLocal({
      port: 0, home, env: {}, webDir: webDir(), log: () => undefined,
      spec: () => readConfig(home).repo as string | undefined,
      startReal: async (port, setup) => { started.push(port); const server = await startWeb({ dir: repo, port, webDir: webDir(), agents: false, setup, ...quiet }); return { server, dir: repo }; },
    });
    try {
      const port = new URL(h.url).port;
      expect(await (await fetch(`${h.url}/.auth/me`)).json()).toMatchObject({ setup: true });
      await post(h.url, { step: 'repo', repo });
      await h.settled();
      expect(started).toEqual([Number(port)]);
      expect(new URL(h.url).port).toBe(port);
      const me = await (await fetch(`${h.url}/.auth/me`)).json() as { setup?: boolean };
      expect(me.setup).toBeUndefined();
      expect(await (await fetch(`${h.url}/setup`)).json()).toMatchObject({ needed: true, reason: 'resume', step: 'mode' });
    } finally { await h.close(); }
  });

  // @req FR:first-run-onboarding/host.broken
  it('falls back to the setup server with the error when the real server fails', async () => {
    const home = tmp(); writeConfig(home, { repo: '/gone' });
    const h = await runLocal({ port: 0, home, env: {}, webDir: webDir(), log: () => undefined, spec: () => '/gone', startReal: async () => { throw new Error('/gone is not a git repo'); } });
    try {
      expect(await (await fetch(`${h.url}/setup`)).json()).toMatchObject({ needed: true, reason: 'broken', step: 'repo', error: '/gone is not a git repo' });
    } finally { await h.close(); }
  });

  // @req FR:first-run-onboarding/step.mode.tasks
  it('a saved repo with no tasks/ and no live mode waits in setup at the mode step, no error', async () => {
    const home = tmp(); const repo = gitRepo(null); writeConfig(home, { repo, onboarding: { step: 'mode' } });
    let calls = 0;
    const h = await runLocal({ port: 0, home, env: {}, webDir: webDir(), log: () => undefined, spec: () => repo, startReal: async () => { calls++; throw new Error('x'); } });
    try {
      expect(calls).toBe(0);
      const s = await (await fetch(`${h.url}/setup`)).json() as { step: string; error?: string };
      expect(s.step).toBe('mode');
      expect(s.error).toBeUndefined();
    } finally { await h.close(); }
  });
});

describe('config file content', () => {
  it('never holds anything but JSON', () => {
    const home = tmp(); writeConfig(home, { ics: 'https://x.test/a.ics' });
    expect(() => JSON.parse(readFileSync(join(home, '.config/stack/config.json'), 'utf8'))).not.toThrow();
  });
});
