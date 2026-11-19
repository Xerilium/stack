import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { asksPath, handleAsk, parseAsk } from '../../src/core/asks';
import { emailCmd } from '../../src/cli/email';
import { groupKey, mailKey, newSummary, recordResult, resolveAsk, tally } from '../../src/email/to-ask';
import type { TriageResult } from '../../src/email/types';
import { FileTokenCache } from '../../src/graph/auth';
import { mkCtx, msg, NOW } from './fixtures';

const tmp = () => mkdtempSync(join(tmpdir(), 'email-group-'));
const read = async (s: { read(p: string): Promise<{ content: string }> }, key: string) => parseAsk(key, (await s.read(asksPath(key))).content);
const NOTICE = 'New app(s) connected to your Microsoft account';
const ms = { name: 'Microsoft account team', address: 'account-security-noreply@accountprotection.example.test' };
const decide = (id: string, over: Partial<TriageResult['message']> = {}): TriageResult => ({
  message: msg({ id, conversationId: `conv-${id}`, subject: NOTICE, from: ms, webLink: `https://outlook.example.test/mail/id/${id}`, ...over }),
  class: 'needs_decision', confidence: 0.7, options: ['Review the app', 'Ignore'], recommend: 'Review the app',
});

// @req FR:email-triage/ask.group @req FR:email-triage/ask.group.count
describe('grouped decide asks', () => {
  it('keys by sender address and normalized subject', () => {
    const k = groupKey(msg({ subject: NOTICE, from: ms }));
    expect(k).toMatch(/^mail-[0-9a-f]{12}$/);
    expect(groupKey(msg({ subject: `  RE: Fw: fwd: ${NOTICE.toUpperCase()} `, from: { name: 'Other name', address: ms.address.toUpperCase() } }))).toBe(k);
    expect(groupKey(msg({ subject: NOTICE, from: { address: 'other@example.test' } }))).not.toBe(k);
    expect(groupKey(msg({ subject: `${NOTICE} (2)`, from: ms }))).not.toBe(k);
    expect(k).not.toBe(mailKey('conv-a'));
  });

  it('two results from one sender and subject in two conversations give one ask with (2 mails) and the newest link', async () => {
    const { storage, ctx } = mkCtx();
    const key = groupKey(decide('a').message);
    expect(await recordResult(ctx, decide('a'))).toEqual({ key, created: true });
    expect((await read(storage, key)).ask).toBe(`Decide on ${ms.name}: ${NOTICE}`);
    expect(await recordResult(ctx, decide('b'))).toEqual({ key, created: false });
    const a = await read(storage, key);
    expect(a).toMatchObject({ state: 'open', kind: 'decide', ask: `Decide on ${ms.name}: ${NOTICE} (2 mails)`, link: 'https://outlook.example.test/mail/id/b' });
    expect(await storage.listAsks!()).toHaveLength(1);
  });

  it('the same mail seen again does not count twice', async () => {
    const { storage, ctx } = mkCtx();
    const key = groupKey(decide('a').message);
    await recordResult(ctx, decide('a'));
    await recordResult(ctx, decide('b'));
    await recordResult(ctx, decide('a'));
    await recordResult(ctx, decide('b'));
    expect((await read(storage, key)).ask).toMatch(/\(2 mails\)$/);
    await recordResult(ctx, decide('c'));
    expect((await read(storage, key)).ask).toMatch(/\(3 mails\)$/);
  });

  it('the same subject from two senders gives two asks', async () => {
    const { storage, ctx } = mkCtx();
    await recordResult(ctx, decide('a'));
    await recordResult(ctx, decide('b', { from: { name: 'Other', address: 'other@example.test' } }));
    expect(await storage.listAsks!()).toHaveLength(2);
  });

  it('sensitive results group the same way', async () => {
    const { storage, ctx } = mkCtx();
    const s = (id: string): TriageResult => ({ message: msg({ id, conversationId: `c-${id}`, subject: 'Payroll update', from: ms }), class: 'sensitive', confidence: 1 });
    await recordResult(ctx, s('a'));
    await recordResult(ctx, s('b'));
    const asks = await storage.listAsks!();
    expect(asks).toHaveLength(1);
    expect((await read(storage, groupKey(s('a').message))).ask).toBe(`Sensitive mail from ${ms.name}: Payroll update (2 mails)`);
  });

  it('needs_reply results in two threads still give two review asks', async () => {
    const { storage, ctx } = mkCtx();
    const draft = { text: 'Thanks', webLink: 'https://outlook.example.test/mail/drafts/D' };
    for (const id of ['a', 'b']) await recordResult(ctx, { ...decide(id), class: 'needs_reply', draft });
    expect((await storage.listAsks!()).sort()).toEqual([asksPath(mailKey('conv-a')), asksPath(mailKey('conv-b'))].sort());
  });

  // @req FR:email-triage/ask.group.reopen
  it('a handled group ask stays handled for a mail it has seen; a new mail opens it again at 1', async () => {
    const { storage, ctx } = mkCtx();
    const key = groupKey(decide('a').message);
    await recordResult(ctx, decide('a'));
    await recordResult(ctx, decide('b'));
    await handleAsk(ctx, key, { outcome: 'resolved' }, 'owner');
    expect(await recordResult(ctx, decide('b'))).toBeNull();
    expect((await read(storage, key)).state).toBe('done');
    expect(await recordResult(ctx, decide('c'))).toEqual({ key, created: false });
    expect(await read(storage, key)).toMatchObject({ state: 'open', ask: `Decide on ${ms.name}: ${NOTICE}`, link: 'https://outlook.example.test/mail/id/c' });
  });

  // @req FR:email-triage/ask.group.resolve
  it('an owner reply in one of the threads resolves the group ask', async () => {
    const { storage, ctx } = mkCtx();
    await recordResult(ctx, decide('a'));
    expect(await resolveAsk(ctx, decide('a').message)).toBe(true);
    expect((await read(storage, groupKey(decide('a').message))).state).toBe('done');
  });

  // @req FR:email-triage/ask.group.summary
  it('the run summary counts one ask per group', () => {
    const s = newSummary();
    for (const id of ['a', 'b', 'c']) tally(s, decide(id), 'model');
    tally(s, decide('d', { from: { address: 'other@example.test' } }), 'model');
    expect(s).toMatchObject({ messages: 4, asks: 2 });
    expect(JSON.parse(JSON.stringify(s)).asks).toBe(2);
  });

  // @req FR:email-runner/cli.offline @req FR:email-triage/ask.group.summary
  it('an offline dry run with a fixture shows the grouped count', async () => {
    const { ctx } = mkCtx();
    const f = join(tmp(), 'messages.json');
    const m = (id: string, subject: string) => ({ id, conversationId: `c-${id}`, subject, from: { emailAddress: { name: 'Payroll', address: 'payroll@example.test' } }, receivedDateTime: NOW.toISOString(), bodyPreview: 'x' });
    writeFileSync(f, JSON.stringify([m('o1', 'Payroll update'), m('o2', 'RE: Payroll update'), m('o3', 'Payroll update')]));
    const r = await emailCmd(ctx, 'run', { 'dry-run': true, offline: true, fixture: f, account: 'sam@example.test' }, { cache: new FileTokenCache(join(tmp(), 'none.json')), dataDir: tmp() });
    expect(r.json).toMatchObject({ ok: true, offline: true, messages: 3, asks: 1 });
    expect(r.text).toContain('1 asks');
  });
});
