/**
 * Settings: the route, the account rows (status word, tip, fix), account badges for the calendar, and the agents line.
 * @req FR:settings/view.route @req FR:settings/agents.state @req FR:connect-accounts/web.row @req FR:connect-accounts/web.fix @req FR:connect-accounts/web.label
 */
import { describe, expect, it } from 'vitest';
import { buildHash, parseHash } from '../src/filters';
import { CHORDS, HINT, LABEL, RAIL } from '../src/nav';
import { DRAFTS_HINT, DRAFTS_LABEL, needsFix, READ_TEXT, STATE_TEXT, statusTip, type AccountRow } from '../src/connect';
import { accountBadge, agentsLines, multiAccount, settingsSection } from '../src/settings';

const row: AccountRow = { account: 'me@outlook.com', type: 'personal', mail: true, calendar: true, drafts: false, state: 'connected' };
const NOW = new Date('2026-11-12T18:00:00Z');

describe('settings route', () => {
  // @req FR:settings/view.route
  it('#/settings and its sections open Settings; the section is read from the hash', () => {
    expect(parseHash('#/settings').view).toBe('settings');
    expect(parseHash('#/settings/accounts').view).toBe('settings');
    expect(buildHash('settings', parseHash('#/settings').filters)).toBe('#/settings');
    expect(settingsSection('#/settings/accounts')).toBe('accounts');
    expect(settingsSection('#/settings/agents')).toBe('agents');
    expect(settingsSection('#/settings/updates')).toBe('updates');
    expect(settingsSection('#/settings/nope')).toBeNull();
    expect(settingsSection('#/settings')).toBeNull();
  });
  // @req FR:settings/view.entry
  it('is not a rail view; the chord is g ,', () => {
    expect(RAIL).not.toContain('settings');
    expect(LABEL.settings).toBe('Settings');
    expect(HINT.settings).toBe('g ,');
    expect(CHORDS[',']).toBe('settings');
  });
});

describe('account rows', () => {
  // @req FR:connect-accounts/web.row
  it('one short word per state', () => {
    expect(STATE_TEXT).toEqual({ connected: 'Connected', expired: 'Needs sign-in', down: 'Microsoft not responding', error: 'Not working' });
  });
  // @req FR:connect-accounts/web.row
  it('the tip has the last good read and, when down, the retry', () => {
    expect(statusTip(row, NOW)).toBe('Never synced');
    const ok = { ...row, lastOkAt: '2026-11-12T17:41:00Z' };
    expect(statusTip(ok, NOW)).toMatch(/^Last synced /);
    expect(statusTip({ ...ok, state: 'down', retryAt: '2026-11-12T18:02:00Z' }, NOW)).toMatch(/^Last synced .+ · Retrying in 2 min$/);
    expect(statusTip({ ...ok, state: 'down', retryAt: '2026-11-12T17:59:00Z' }, NOW)).toMatch(/Retrying now$/);
  });
  // @req FR:connect-accounts/web.fix
  it('Fix only for needs sign-in and not working; never for an outage', () => {
    expect(needsFix({ ...row, state: 'expired' })).toBe(true);
    expect(needsFix({ ...row, state: 'error' })).toBe(true);
    expect(needsFix({ ...row, state: 'down' })).toBe(false);
    expect(needsFix(row)).toBe(false);
  });
  // @req FR:connect-accounts/web.menu @req FR:connect-accounts/web.learn
  it('short words: one-line drafts hint, one-line summary', () => {
    expect(DRAFTS_LABEL).toBe('Let Stack save reply drafts in my mailbox');
    expect(DRAFTS_HINT).toBe('Stack writes drafts for you to review. It never sends.');
    expect(READ_TEXT).toBe('Stack reads mail and calendar. It never sends.');
  });
});

describe('account badges', () => {
  // @req FR:connect-accounts/web.label
  it('first letter and a color fixed per account', () => {
    const a = accountBadge('michael@allyte.com');
    expect(a.letter).toBe('M');
    expect(a.tone).toMatch(/^t[0-5]$/);
    expect(accountBadge('michael@allyte.com')).toEqual(a);
    const tones = new Set(['a@x.test', 'b@x.test', 'c@x.test', 'd@x.test', 'e@x.test', 'f@x.test', 'g@x.test'].map((x) => accountBadge(x).tone));
    expect(tones.size).toBeGreaterThan(1);
  });
  // @req FR:connect-accounts/web.label
  it('labels only when events come from more than one account', () => {
    expect(multiAccount([{ account: 'a@x.test' }, { account: 'a@x.test' }, {}])).toBe(false);
    expect(multiAccount([{ account: 'a@x.test' }, { account: 'B@x.test' }])).toBe(true);
  });
});

describe('agents line', () => {
  // @req FR:settings/agents.state @req FR:settings/agents.off
  it('delivery and Claude sign-in in plain words; sign-in offered when not signed in', () => {
    expect(agentsLines({ mode: 'claude', login: 'ok' })).toEqual({ delivery: 'On', login: 'Signed in', signIn: false, note: null });
    expect(agentsLines({ mode: 'claude', login: 'expired' })).toEqual({ delivery: 'On', login: 'Sign-in expired', signIn: true, note: null });
    expect(agentsLines({ mode: 'off', login: 'unknown' })).toEqual({ delivery: 'Off', login: 'Unknown', signIn: true, note: 'Turn it on in Stack settings on your Mac.' });
  });
});
