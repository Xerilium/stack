/**
 * Inbox source status: records, state, freshness, summary, help text.
 * @req FR:inbox-page/src.shape @req FR:inbox-page/src.record @req FR:inbox-page/src.state @req FR:inbox-page/src.fresh @req FR:inbox-page/src.planned
 * @req FR:inbox-page/src.multi @req FR:inbox-page/src.summary @req FR:inbox-page/src.help @req FR:inbox-page/src.safe
 */
import { MemoryStorage } from '../../src/core/storage';
import { buildSources, DEFAULT_FRESH_MINUTES, parseRecords, readRecords, recordSync, SOURCES_PATH, summarize, type SourceProbe, type SyncRecord } from '../../src/inbox';

const NOW = new Date('2026-11-11T18:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const probe = (o: Partial<SourceProbe> = {}): SourceProbe => ({ emails: [], github: false, ...o });
const build = (o: { probe?: SourceProbe; records?: SyncRecord[]; accounts?: string[]; freshMinutes?: number } = {}) =>
  buildSources({ now: NOW, records: o.records ?? [], ...(o.probe ? { probe: o.probe } : {}), ...(o.accounts ? { accounts: o.accounts } : {}), ...(o.freshMinutes ? { freshMinutes: o.freshMinutes } : {}) });
const by = (s: ReturnType<typeof build>, kind: string, account = '') => s.find((x) => x.kind === kind && x.account === account)!;

describe('buildSources', () => {
  it('nothing known: one empty email row, GitHub, and planned Teams and Slack, all not connected', () => {
    const s = build({ probe: probe() });
    expect(s.map((x) => [x.kind, x.account, x.state, !!x.planned])).toEqual([
      ['email', '', 'not-connected', false], ['github', '', 'not-connected', true], ['teams', '', 'not-connected', true], ['slack', '', 'not-connected', true],
    ]);
    const m = summarize(s, NOW);
    expect(m).toMatchObject({ connected: 0, total: 1, fresh: 0, attention: true, canClaimZero: false, headline: 'No inboxes connected' });
  });

  it('each email account is its own source, sorted, with its own state', () => {
    const s = build({
      probe: probe({ emails: [{ account: 'b@contoso.test', mode: 'drafts' }, { account: 'a@outlook.com', mode: 'read-only' }, { account: 'c@outlook.com', mode: 'read-only' }], clientId: '11111111-2222-3333-4444-555555555555' }),
      records: [{ kind: 'email', account: 'a@outlook.com', at: ago(5), ok: true }, { kind: 'email', account: 'b@contoso.test', at: ago(10), ok: false, error: 'signin-expired' }],
      accounts: ['d@outlook.com'],
    });
    const mail = s.filter((x) => x.kind === 'email');
    expect(mail.map((x) => [x.account, x.state, x.mode])).toEqual([
      ['a@outlook.com', 'ok', 'read-only'], ['b@contoso.test', 'error', 'drafts'], ['c@outlook.com', 'connecting', 'read-only'], ['d@outlook.com', 'not-connected', undefined],
    ]);
    expect(by(s, 'email', 'a@outlook.com').lastSyncAt).toBe(ago(5));
    expect(by(s, 'email', 'b@contoso.test').error).toBe('Email sign-in expired: b@contoso.test');
  });

  it('an ok record older than the window is stale; the window comes from config', () => {
    const rec: SyncRecord[] = [{ kind: 'email', account: 'a@outlook.com', at: ago(45), ok: true }];
    const p = probe({ emails: [{ account: 'a@outlook.com', mode: 'read-only' }] });
    expect(DEFAULT_FRESH_MINUTES).toBe(30);
    expect(by(build({ probe: p, records: rec }), 'email', 'a@outlook.com').state).toBe('stale');
    expect(by(build({ probe: p, records: rec, freshMinutes: 60 }), 'email', 'a@outlook.com').state).toBe('ok');
  });

  it('with no probe (hosted app), sources come from the records and the configured accounts', () => {
    const s = build({ records: [{ kind: 'email', account: 'a@outlook.com', at: ago(5), ok: true }], accounts: ['z@outlook.com'] });
    expect(s.filter((x) => x.kind === 'email').map((x) => [x.account, x.state])).toEqual([['a@outlook.com', 'ok'], ['z@outlook.com', 'not-connected']]);
  });

  it('an unreadable token cache is an error that names the fix, never the file content', () => {
    const s = build({ probe: probe({ emails: [{ account: 'a@outlook.com', mode: 'read-only', error: 'token-unreadable' }] }) });
    const a = by(s, 'email', 'a@outlook.com');
    expect(a.state).toBe('error');
    expect(a.needs).toMatch(/chmod 600/);
  });

  it('GitHub: signed in without a sync is connecting; records apply', () => {
    expect(by(build({ probe: probe({ github: true }) }), 'github').state).toBe('connecting');
    expect(by(build({ probe: probe({ github: true }), records: [{ kind: 'github', account: '', at: ago(1), ok: true }] }), 'github').state).toBe('ok');
    const g = by(build({ probe: probe() }), 'github');
    expect(g).toMatchObject({ state: 'not-connected', command: 'gh auth login' });
  });

  it('help: the exact sign-in command, read-only by default, drafts kept, and Stack never sends', () => {
    const s = build({
      probe: probe({ emails: [{ account: 'b@contoso.test', mode: 'drafts' }], clientId: '11111111-2222-3333-4444-555555555555' }),
      records: [{ kind: 'email', account: 'b@contoso.test', at: ago(10), ok: false, error: 'signin-expired' }], accounts: ['d@outlook.com'],
    });
    expect(by(s, 'email', 'd@outlook.com').command).toBe('stack graph login --client-id 11111111-2222-3333-4444-555555555555 --account d@outlook.com --with mail');
    expect(by(s, 'email', 'd@outlook.com').needs).toMatch(/read-only/i);
    expect(by(s, 'email', 'd@outlook.com').needs).toMatch(/mail,drafts/);
    expect(by(s, 'email', 'd@outlook.com').needs).toMatch(/Stack never sends/);
    expect(by(s, 'email', 'b@contoso.test').command).toBe('stack graph login --client-id 11111111-2222-3333-4444-555555555555 --account b@contoso.test --with mail,drafts');
    expect(by(build({ probe: probe() }), 'email').command).toBe('stack graph login --client-id <app id> --account <address> --with mail');
    expect(by(s, 'email', 'd@outlook.com').doc).toMatch(/docs\/inbox-sources\.md#email$/);
  });

  it('help per state: connecting runs the first sync, stale runs all, model down runs claude', () => {
    const p = probe({ emails: [{ account: 'a@outlook.com', mode: 'read-only' }, { account: 'b@outlook.com', mode: 'read-only' }, { account: 'c@outlook.com', mode: 'read-only' }] });
    const s = build({ probe: p, records: [{ kind: 'email', account: 'b@outlook.com', at: ago(300), ok: true }, { kind: 'email', account: 'c@outlook.com', at: ago(1), ok: false, error: 'model-down' }] });
    expect(by(s, 'email', 'a@outlook.com').command).toBe('stack email run --account a@outlook.com');
    expect(by(s, 'email', 'b@outlook.com').command).toBe('stack email run --all');
    expect(by(s, 'email', 'c@outlook.com').command).toBe('claude');
    expect(by(s, 'email', 'c@outlook.com').state).toBe('error');
  });

  it('Teams and Slack say what they need and link the doc', () => {
    const s = build({ probe: probe() });
    expect(by(s, 'teams').needs).toMatch(/Chat\.Read/);
    expect(by(s, 'slack').needs).toMatch(/xoxp-/);
    expect(by(s, 'teams').doc).toMatch(/#teams$/);
    expect(by(s, 'slack').doc).toMatch(/#slack$/);
  });
  it('a client id that is not a GUID never reaches the sign-in command', () => {
    const s = build({ probe: probe({ emails: [{ account: 'a@outlook.com', mode: 'read-only', error: 'token-unreadable' }], clientId: '$(id)' }) });
    expect(by(s, 'email', 'a@outlook.com').command).toBe('stack graph login --client-id <app id> --account a@outlook.com --with mail');
  });
  it('an onboarding mail sign-in with no mailbox name is connected, waiting for its first sync', () => {
    const s = build({ probe: probe({ unnamedMail: { mode: 'drafts' } }) });
    expect(by(s, 'email')).toMatchObject({ state: 'connecting', mode: 'drafts', command: 'stack email run --account <address>' });
    expect(summarize(s, NOW)).toMatchObject({ connected: 1, canClaimZero: false, headline: 'Waiting for the first sync' });
  });
  it('records with an unsafe account are dropped, so no shell text reaches a command', () => {
    expect(parseRecords({ records: [{ kind: 'email', account: 'a@x.com; rm -rf ~', at: ago(1), ok: false, error: 'signin-expired' }, { kind: 'github', account: '$(id)', at: ago(1), ok: true }] })).toEqual([]);
    const s = build({ records: [{ kind: 'email', account: 'a@x.com`id`', at: ago(1), ok: false, error: 'signin-expired' }], accounts: ['b@x.com'] });
    expect(s.filter((x) => x.kind === 'email').map((x) => x.account)).toEqual(['b@x.com']);
  });

  it('no probe: an expired drafts mailbox keeps --with mail,drafts from its record', () => {
    const s = build({ records: [{ kind: 'email', account: 'b@contoso.test', at: ago(1), ok: false, error: 'signin-expired', mode: 'drafts' }] });
    expect(by(s, 'email', 'b@contoso.test').command).toMatch(/--with mail,drafts$/);
  });

  it('GitHub stays planned (not counted) until its runner reports', () => {
    expect(by(build({ probe: probe({ github: true }) }), 'github').planned).toBe(true);
    expect(by(build({ probe: probe({ github: true }), records: [{ kind: 'github', account: '', at: ago(1), ok: true }] }), 'github').planned).toBeUndefined();
  });
});

describe('summarize', () => {
  const p = (n: number) => probe({ emails: Array.from({ length: n }, (_, i) => ({ account: `m${i}@outlook.com`, mode: 'read-only' as const })), github: true });
  const ok = (i: number, min = 1): SyncRecord => ({ kind: 'email', account: `m${i}@outlook.com`, at: ago(min), ok: true });
  const gh: SyncRecord = { kind: 'github', account: '', at: ago(1), ok: true };

  it('all fresh: no headline, may claim zero, no dot', () => {
    expect(summarize(build({ probe: p(2), records: [ok(0), ok(1), gh] }), NOW)).toMatchObject({ connected: 3, total: 3, fresh: 3, attention: false, canClaimZero: true, headline: null });
  });
  it('one error: its message; several: a count', () => {
    const one = build({ probe: p(2), records: [ok(0), { kind: 'email', account: 'm1@outlook.com', at: ago(1), ok: false, error: 'signin-expired' }, gh] });
    expect(summarize(one, NOW)).toMatchObject({ attention: true, headline: 'Email sign-in expired: m1@outlook.com', canClaimZero: false });
    const two = build({ probe: p(2), records: [{ kind: 'email', account: 'm0@outlook.com', at: ago(1), ok: false, error: 'sync-failed' }, { kind: 'email', account: 'm1@outlook.com', at: ago(1), ok: false, error: 'signin-expired' }] });
    expect(summarize(two, NOW).headline).toBe('2 inboxes need attention');
  });
  it('nothing fresh: last synced, newest first; or waiting for the first sync', () => {
    const stale = summarize(build({ probe: probe({ emails: [{ account: 'm0@outlook.com', mode: 'read-only' }, { account: 'm1@outlook.com', mode: 'read-only' }], github: true }), records: [ok(0, 180), ok(1, 300)] }), NOW);
    expect(stale).toMatchObject({ headline: 'Last synced 3h ago', canClaimZero: false, attention: false });
    expect(summarize(build({ probe: probe({ emails: [{ account: 'm0@outlook.com', mode: 'read-only' }], github: true }) }), NOW)).toMatchObject({ headline: 'Waiting for the first sync', canClaimZero: false });
  });
  it('some stale: N of M up to date; some missing: N of M connected', () => {
    expect(summarize(build({ probe: p(2), records: [ok(0), ok(1, 90), gh] }), NOW)).toMatchObject({ headline: '2 of 3 inboxes up to date', canClaimZero: false });
    expect(summarize(build({ probe: p(2), records: [ok(0), ok(1), gh], accounts: ['x@outlook.com'] }), NOW)).toMatchObject({ headline: '3 of 4 sources connected', attention: true, canClaimZero: false });
  });
  it('one fresh and one waiting: says so, no zero, never "No inboxes connected"', () => {
    expect(summarize(build({ probe: p(2), records: [ok(0), gh] }), NOW)).toMatchObject({ headline: '2 of 3 inboxes synced; waiting for the first sync', canClaimZero: false });
  });
  it('planned sources never count, never set the dot', () => {
    const m = summarize(build({ probe: p(1), records: [ok(0), gh] }), NOW);
    expect(m).toMatchObject({ total: 2, attention: false });
  });
});

describe('sync records', () => {
  it('replace by kind and account, keep codes only, and survive a bad file', async () => {
    const st = new MemoryStorage();
    await recordSync(st, { kind: 'email', account: 'A@Outlook.com', at: ago(10), ok: true });
    await recordSync(st, { kind: 'email', account: 'a@outlook.com', at: ago(1), ok: false, error: 'signin-expired' });
    await recordSync(st, { kind: 'github', account: '', at: ago(2), ok: true });
    expect(await readRecords(st)).toEqual([{ kind: 'email', account: 'a@outlook.com', at: ago(1), ok: false, error: 'signin-expired' }, { kind: 'github', account: '', at: ago(2), ok: true }]);
    const raw = (await st.readAux(SOURCES_PATH))!.content;
    expect(raw).not.toMatch(/token|Bearer/i);
    expect(parseRecords({ version: 1, records: [{ kind: 'email', account: 'a@x.com', at: 'x', ok: true }, { kind: 'fax', account: '', at: ago(1), ok: true }, { kind: 'email', account: 'b@x.com', at: ago(1), ok: false, error: 'eyJhbGciOi secret' }] })).toEqual([{ kind: 'email', account: 'b@x.com', at: ago(1), ok: false, error: 'sync-failed' }]);
    expect(parseRecords('nope')).toEqual([]);
  });
});
