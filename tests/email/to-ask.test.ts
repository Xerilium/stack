import { createHash } from 'crypto';
import { asksPath, parseAsk } from '../../src/core/asks';
import { NotFoundError } from '../../src/core/storage';
import { QUIET_CLASSES, mailKey, newSummary, recordResult, resolveAsk, tally, toAsk } from '../../src/email/to-ask';
import type { TriageResult } from '../../src/email/types';
import { NOW, mkCtx, msg } from './fixtures';

const read = async (s: { read(p: string): Promise<{ content: string }> }, key: string) => parseAsk(key, (await s.read(asksPath(key))).content);
const draft = { text: `⟦AI draft: review before sending⟧\n${'Thanks, that works for me. '.repeat(40)}`, webLink: 'https://outlook.example.test/mail/drafts/D1' };
const reply = (over: Partial<TriageResult> = {}): TriageResult => ({ message: msg(), class: 'needs_reply', confidence: 0.9, reason: 'Direct question', urgency: 2, draft, ...over });
const KEY = mailKey('conv-1');

// @req FR:email-triage/ask.reply
describe('ask from a needs_reply result', () => {
  it('keys the ask by a hash of the conversation', () => {
    expect(KEY).toBe(`mail-${createHash('sha1').update('conv-1').digest('hex').slice(0, 12)}`);
    expect(KEY).toMatch(/^mail-[0-9a-f]{12}$/);
    expect(mailKey('conv-2')).not.toBe(KEY);
  });

  it('becomes a review ask with the draft link and a 600 character detail', async () => {
    const { storage, ctx } = mkCtx();
    expect(await recordResult(ctx, reply(), { project: 'work' })).toEqual({ key: KEY, created: true });
    const a = await read(storage, KEY);
    expect(a).toMatchObject({
      kind: 'review', state: 'open', ask: 'Review draft reply to Alex Rivera: Quarterly plan', recommend: 'Send as drafted', link: draft.webLink,
      default: 'Draft stays in Drafts (nothing is sent)', reversible: true, project: 'work', from: 'email-triage',
    });
    expect(a.detail).toBe(draft.text.slice(0, 600).trim());
    expect(a.detail.length).toBeGreaterThan(590);
  });

  it('recommends by model confidence', () => {
    expect(toAsk(reply({ confidence: 0.85 }))?.recommend).toBe('Send as drafted');
    expect(toAsk(reply({ confidence: 0.79 }))?.recommend).toBe('Edit then send');
    expect(toAsk(reply({ confidence: 0.2 }))?.recommend).toBe('Edit then send');
  });

  it('falls back to the sender address, clips long subjects, drops a non-https link', async () => {
    const { storage, ctx } = mkCtx();
    const m = msg({ from: { address: 'pat@example.test' }, subject: `Re: ${'very long '.repeat(40)}` });
    const input = toAsk(reply({ message: m, draft: { text: 'x', webLink: 'http://outlook.example.test/d' } }))!;
    expect(input.ask!.startsWith('Review draft reply to pat@example.test: Re: very long')).toBe(true);
    expect(input.ask!.length).toBeLessThanOrEqual(200);
    expect(input.link).toBeUndefined();
    await expect(recordResult(ctx, reply({ message: m }))).resolves.toMatchObject({ created: true });
    expect((await read(storage, KEY)).ask.length).toBeLessThanOrEqual(200);
  });

  it('redacts secrets in the detail and never writes the original body', async () => {
    const { storage, ctx } = mkCtx();
    await recordResult(ctx, reply({ message: msg({ bodyPreview: 'ORIGINAL-BODY-TEXT' }), draft: { ...draft, text: 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 now' } }));
    const raw = (await storage.read(asksPath(KEY))).content;
    expect(raw).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
    expect(raw).not.toContain('ORIGINAL-BODY-TEXT');
  });

  it('a needs_reply with no draft still reaches the owner as go-do', () => {
    const input = toAsk(reply({ draft: undefined }))!;
    expect(input).toMatchObject({ kind: 'go-do', ask: 'Reply to Alex Rivera: Quarterly plan', link: msg().webLink, reversible: true, from: 'email-triage' });
    expect(input.detail).toBeUndefined();
  });

  it('idempotent: the same conversation twice updates one ask', async () => {
    const { storage, ctx } = mkCtx();
    expect(await recordResult(ctx, reply())).toEqual({ key: KEY, created: true });
    expect(await recordResult(ctx, reply({ confidence: 0.3 }))).toEqual({ key: KEY, created: false });
    expect(await storage.listAsks!()).toEqual([asksPath(KEY)]);
    expect((await read(storage, KEY)).recommend).toBe('Edit then send');
  });

  it('leaves a handled ask alone', async () => {
    const { storage, ctx } = mkCtx();
    await recordResult(ctx, reply());
    await resolveAsk(ctx, msg({ from: { address: 'me@example.test' } }));
    expect(await recordResult(ctx, reply())).toBeNull();
    expect((await read(storage, KEY)).state).toBe('done');
  });
});

// @req FR:email-triage/ask.decide
describe('ask from a needs_decision or sensitive result', () => {
  const decide = (over: Partial<TriageResult> = {}): TriageResult => ({ message: msg(), class: 'needs_decision', confidence: 0.7, reason: 'Needs your call', options: ['Accept the offer', 'Decline', 'Counter at +10%'], recommend: 'Decline', ...over });

  it('becomes a decide ask with the model options and recommendation', async () => {
    const { storage, ctx } = mkCtx();
    await recordResult(ctx, decide(), { project: 'work' });
    expect(await read(storage, KEY)).toMatchObject({ kind: 'decide', options: ['Accept the offer', 'Decline', 'Counter at +10%'], recommend: 'Decline', project: 'work', from: 'email-triage' });
  });

  it('keeps 2-4 options; pipes and blanks cleaned; fewer than two degrades to an answer ask', () => {
    expect(toAsk(decide({ options: ['a', 'b', 'c', 'd', 'e'] }))?.options).toEqual(['a', 'b', 'c', 'd']);
    expect(toAsk(decide({ options: ['a | b', ' ', 'a | b', 'c'] }))?.options).toEqual(['a / b', 'c']);
    expect(toAsk(decide({ options: ['x'.repeat(200), 'y'] }))?.options?.[0].length).toBeLessThanOrEqual(80);
    const one = toAsk(decide({ options: ['only'] }))!;
    expect(one.kind).toBe('answer');
    expect(one.options).toBeUndefined();
    expect(toAsk(decide({ options: undefined }))?.kind).toBe('answer');
  });

  it('sensitive becomes go-do with sender and subject only, no body', async () => {
    const { storage, ctx } = mkCtx();
    const m = msg({ from: { name: 'Counsel', address: 'counsel@example.test' }, subject: 'Settlement terms', bodyPreview: 'SECRET-BODY-TEXT $1,000,000' });
    await recordResult(ctx, { message: m, class: 'sensitive', confidence: 1, reason: 'denylist', draft });
    const a = await read(storage, KEY);
    expect(a).toMatchObject({ kind: 'go-do', ask: 'Sensitive mail from Counsel: Settlement terms', from: 'email-triage', link: m.webLink });
    expect(a.detail).toBe('');
    const raw = (await storage.read(asksPath(KEY))).content;
    expect(raw).not.toContain('SECRET-BODY-TEXT');
    expect(raw).not.toContain('Thanks, that works');
    expect(a.why).toBeUndefined();
  });
});

// @req FR:email-triage/ask.quiet
describe('quiet classes', () => {
  it('create no ask and only move counters', async () => {
    const { storage, ctx } = mkCtx();
    expect([...QUIET_CLASSES].sort()).toEqual(['calendar', 'fyi', 'newsletter', 'receipt', 'skip', 'spam']);
    const summary = newSummary();
    for (const c of QUIET_CLASSES) {
      const r: TriageResult = { message: msg({ conversationId: `c-${c}` }), class: c, confidence: 1 };
      expect(toAsk(r)).toBeNull();
      expect(await recordResult(ctx, r)).toBeNull();
      tally(summary, r, 'rule');
    }
    expect(await storage.listAsks!()).toEqual([]);
    expect(summary).toMatchObject({ messages: 6, rules: 6, model: 0, asks: 0, counts: { newsletter: 1, receipt: 1, calendar: 1, skip: 1, fyi: 1, spam: 1 } });
  });

  it('counts asks and model-settled results', () => {
    const s = newSummary();
    tally(s, reply(), 'model');
    tally(s, { message: msg(), class: 'fyi', confidence: 0.9 }, 'model');
    expect(s).toMatchObject({ messages: 2, rules: 0, model: 2, asks: 1, drafts: 1 });
    expect(s.counts.needs_reply).toBe(1);
  });
});

// @req FR:email-triage/ask.resolve
describe('resolving on an owner reply', () => {
  it('handles the ask as resolved when the owner replied in the thread', async () => {
    const { storage, ctx } = mkCtx();
    await recordResult(ctx, reply());
    const own = msg({ id: 'AAMk-msg-2', from: { address: 'me@example.test' } });
    expect(await resolveAsk(ctx, own)).toBe(true);
    expect(await read(storage, KEY)).toMatchObject({ state: 'done', outcome: 'resolved', handled: expect.stringContaining('email-triage') });
  });

  it('is a no-op when there is no ask or it is already handled', async () => {
    const { ctx } = mkCtx();
    expect(await resolveAsk(ctx, msg())).toBe(false);
    await recordResult(ctx, reply());
    expect(await resolveAsk(ctx, msg())).toBe(true);
    expect(await resolveAsk(ctx, msg())).toBe(false);
  });

  it('only swallows a missing ask', async () => {
    const { storage, ctx } = mkCtx();
    storage.read = async () => { throw new NotFoundError('x'); };
    await expect(resolveAsk(ctx, msg())).resolves.toBe(false);
    storage.read = async () => { throw new Error('disk'); };
    await expect(resolveAsk(ctx, msg())).rejects.toThrow('disk');
    expect(NOW.getTime()).toBeGreaterThan(0);
  });
});
