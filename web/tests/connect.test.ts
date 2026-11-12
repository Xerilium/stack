/**
 * Connect panel words and polling.
 * @req FR:connect-accounts/web.panel @req FR:connect-accounts/web.setup @req FR:connect-accounts/web.signin @req FR:connect-accounts/web.nocmd
 */
import { describe, expect, it } from 'vitest';
import { DRAFTS_TEXT, needsSignIn, readsText, sessionText, SETUP_RESULT, typeText, waitFor, type ConnectSession } from '../src/connect';

const row = { account: 'me@outlook.com', type: 'personal' as const, mail: true, calendar: true, drafts: false, state: 'connected' as const };

describe('connect words', () => {
  it('says what Stack reads, the account type, and that drafts never send', () => {
    expect(readsText(row)).toBe('mail and calendar');
    expect(readsText({ ...row, mail: false })).toBe('calendar');
    expect(typeText(row)).toBe('Personal');
    expect(typeText({ ...row, type: 'work' })).toBe('Work or school');
    expect(DRAFTS_TEXT).toMatch(/never sends/);
    expect(needsSignIn({ ...row, state: 'expired' })).toBe(true);
    expect(needsSignIn(row)).toBe(false);
  });
  it('setup results name the single human step, no command box', () => {
    expect(SETUP_RESULT['needs-azure-signin']).toBe('Sign in to Azure once: open PowerShell, run Connect-AzAccount, then click Run setup again.');
    for (const t of Object.values(SETUP_RESULT)) expect(t).not.toMatch(/stack graph login/);
  });
  it('session text per state and method', () => {
    const s: ConnectSession = { id: '1', method: 'browser', state: 'waiting' };
    expect(sessionText(s)).toBe('Finish signing in in your browser.');
    expect(sessionText({ ...s, method: 'device' })).toMatch(/enter this code/);
    expect(sessionText({ ...s, state: 'done', account: 'me@outlook.com' })).toBe('Connected me@outlook.com');
    expect(sessionText({ ...s, state: 'error', error: 'access_denied' })).toMatch(/declined/);
    expect(sessionText({ ...s, state: 'error', error: 'weird' })).toBe('Sign-in did not finish. Try again.');
  });
  it('polls until the sign-in ends; a failed poll is retried', async () => {
    const replies: (ConnectSession | Error)[] = [new Error('net'), { id: '1', method: 'browser', state: 'waiting' }, { id: '1', method: 'browser', state: 'done', account: 'me@outlook.com' }];
    const seen: string[] = [];
    const end = await waitFor({ connectPoll: async () => { const r = replies.shift()!; if (r instanceof Error) throw r; return r; } }, { id: '1', method: 'browser', state: 'waiting' }, { wait: async () => undefined, onUpdate: (s) => seen.push(s.state) });
    expect(end.state).toBe('done');
    expect(seen).toEqual(['waiting', 'waiting', 'done']);
  });
});

describe('connect review fixes', () => {
  it('a 404 poll (host restarted) ends the session; other failures retry', async () => {
    let n = 0;
    const end = await waitFor({ connectPoll: async () => { n++; throw Object.assign(new Error('gone'), { status: 404 }); } }, { id: '1', method: 'device', state: 'waiting' }, { wait: async () => undefined });
    expect(end).toMatchObject({ state: 'error', error: 'lost' });
    expect(n).toBe(1);
    expect(sessionText(end)).toMatch(/restarted/);
  });
  it('a different account picked says so', () => {
    expect(sessionText({ id: '1', method: 'browser', state: 'error', error: 'account_mismatch' })).toMatch(/different account/);
  });
});
