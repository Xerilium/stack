/** @req FR:first-run-onboarding/web.gate @req FR:first-run-onboarding/state.status @req FR:first-run-onboarding/host.apply @req FR:first-run-onboarding/step.max */
import { describe, expect, it } from 'vitest';
import { authSaysSetup, icsOk, wantsSetup, isLocalHost, loadSetup, parseSetup, postStep, prevStep, STEP_IDS, stepLine, TITLES, waitForHost, type Fetch } from '../src/onboarding';

const status = { needed: true, reason: 'no-repo', step: 'repo', steps: STEP_IDS, repo: null, mode: 'demo', calendar: false, email: false, signIn: 'stack graph login', repoEnv: false };
const reply = (body: unknown, init: { status?: number; type?: string } = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: init.status ?? 200, headers: { 'content-type': init.type ?? 'application/json' } });

describe('onboarding', () => {
  it('is local only', () => {
    expect(isLocalHost('localhost')).toBe(true);
    expect(isLocalHost('127.0.0.1')).toBe(true);
    expect(isLocalHost('stack.example.com')).toBe(false);
  });
  it('has at most 5 steps, each with a title', () => {
    expect(STEP_IDS.length).toBeLessThanOrEqual(5);
    for (const s of STEP_IDS) expect(TITLES[s].length).toBeGreaterThan(0);
    expect(stepLine('mode')).toBe('Step 2 of 5');
    expect(prevStep('repo')).toBeNull();
    expect(prevStep('calendar')).toBe('mode');
  });
  it('parses a reply and refuses anything else', () => {
    expect(parseSetup(status)).toMatchObject({ needed: true, step: 'repo', reason: 'no-repo' });
    expect(parseSetup({ ...status, error: 'x' })?.error).toBe('x');
    expect(parseSetup({ needed: true, step: 'bogus' })).toBeNull();
    expect(parseSetup('<html>')).toBeNull();
    expect(parseSetup(null)).toBeNull();
  });
  it('loadSetup: an html fallback, a 404, or a network error shows the app', async () => {
    expect(await loadSetup(async () => reply(status))).toMatchObject({ needed: true });
    expect(await loadSetup(async () => reply('<!doctype html>', { type: 'text/html' }))).toBeNull();
    expect(await loadSetup(async () => reply({}, { status: 404 }))).toBeNull();
    expect(await loadSetup(async () => { throw new Error('down'); })).toBeNull();
  });
  it('wantsSetup: only a local page marked with the meta tag', () => {
    const doc = (on: boolean) => ({ querySelector: (s: string) => (on && s === 'meta[name="stack-setup"]' ? ({} as Element) : null) });
    expect(wantsSetup(doc(true), 'localhost')).toBe(true);
    expect(wantsSetup(doc(false), 'localhost')).toBe(false);
    expect(wantsSetup(doc(true), 'stack.example.com')).toBe(false);
  });
  it('authSaysSetup: only setup: true', async () => {
    expect(await authSaysSetup(async () => reply({ setup: true }))).toBe(true);
    expect(await authSaysSetup(async () => reply({ clientPrincipal: {} }))).toBe(false);
    expect(await authSaysSetup(async () => { throw new Error('x'); })).toBe(false);
  });
  it('postStep: returns the restart flag or the error line', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f: Fetch = async (url, init) => { calls.push({ url, init }); return reply({ restart: true, status }); };
    expect(await postStep(f, { step: 'repo', repo: '/r' })).toMatchObject({ ok: true, restart: true });
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ step: 'repo', repo: '/r' });
    expect(await postStep(async () => reply({ error: { code: 'invalid', message: 'Folder not found: /x' } }, { status: 400 }), {})).toEqual({ ok: false, error: 'Folder not found: /x' });
    expect(await postStep(async () => { throw new Error('x'); }, {})).toMatchObject({ ok: false, error: expect.stringMatching(/not answering/) });
  });
  it('waitForHost: polls until the host answers', async () => {
    let n = 0;
    const f: Fetch = async () => { n++; if (n < 3) throw new Error('restarting'); return reply(status); };
    expect(await waitForHost(f, { sleep: async () => undefined })).toMatchObject({ step: 'repo' });
    expect(n).toBe(3);
    expect(await waitForHost(async () => { throw new Error('x'); }, { tries: 2, sleep: async () => undefined })).toBeNull();
  });
  it('icsOk: https and webcal only', () => {
    expect(icsOk('https://outlook.office365.com/owa/calendar/x/calendar.ics')).toBe(true);
    expect(icsOk('webcal://p01.icloud.com/x')).toBe(true);
    expect(icsOk('http://x.test/a.ics')).toBe(false);
    expect(icsOk('nope')).toBe(false);
  });
});
