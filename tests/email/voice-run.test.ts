import { createHash } from 'crypto';
import { asksPath, parseAsk } from '../../src/core/asks';
import { DEFAULT_RULES } from '../../src/email/rules';
import { runTriage } from '../../src/email/run';
import { toAsk } from '../../src/email/to-ask';
import type { Classifier, Drafter, MailProvider, TriageResult } from '../../src/email/types';
import { learnVoice } from '../../src/email/voice';
import { mkCtx, msg } from './fixtures';
import { OWNER, SENT } from './voice-fixtures';

const rules = { ...DEFAULT_RULES, owner: ['me@example.test'] };
const keyOf = (c: string) => `mail-${createHash('sha1').update(c).digest('hex').slice(0, 12)}`;
const voice = learnVoice(SENT, OWNER);
const GOOD = "Hi Alex,\n\nFriday works. I'll bring the numbers.\n\nThanks,\nSam";
const BAD = 'Hi Alex,\n\nI hope this email finds you well. Friday works — truly — for us.\n\nBest regards,\nSam';

function setup(drafts: string[]) {
  const created: { id: string; text: string }[] = [];
  const provider: MailProvider = {
    delta: async () => ({ messages: [msg()], cursor: 'c1' }),
    createDraft: async (id, text) => { created.push({ id, text }); return { id: `D-${id}`, webLink: `https://outlook.example.test/mail/drafts/${id}` }; },
  };
  const classifier: Classifier = { classify: async () => ({ class: 'needs_reply', urgency: 1, confidence: 0.95, reason: 'Question' }) };
  const queue = [...drafts];
  const drafter: Drafter = { draft: jest.fn(async () => queue.shift() ?? GOOD) };
  return { provider, classifier, drafter, created };
}
const askOf = async (storage: { read(p: string): Promise<{ content: string }> }) => parseAsk('k', (await storage.read(asksPath(keyOf('conv-1')))).content);

// @req FR:email-voice/score.redraft
describe('runTriage voice check', () => {
  it('keeps a passing first draft and drafts once', async () => {
    const { storage, ctx } = mkCtx();
    const s = setup([GOOD]);
    const { summary } = await runTriage({ ctx, ...s, rules, voice });
    expect(s.drafter.draft).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ drafts: 1, redrafts: 0 });
    const a = await askOf(storage);
    expect(a.recommend).toBe('Send as drafted');
    expect(a.detail).toMatch(/^Voice: 100\/100\n\nHi Alex,/);
  });

  it('redrafts once with the violations as feedback and keeps the better draft', async () => {
    const { storage, ctx } = mkCtx();
    const s = setup([BAD, GOOD]);
    const { summary } = await runTriage({ ctx, ...s, rules, voice });
    expect(s.drafter.draft).toHaveBeenCalledTimes(2);
    const fb = (s.drafter.draft as jest.Mock).mock.calls[1][1].feedback as string[];
    expect(fb.join('\n')).toMatch(/hope this email finds you well/i);
    expect(fb.join('\n')).not.toMatch(/truly/);
    expect(s.created[0].text).toMatch(/Friday works\. I'll bring the numbers\./);
    expect(summary).toMatchObject({ drafts: 1, redrafts: 1 });
    expect((await askOf(storage)).recommend).toBe('Send as drafted');
  });

  it('keeps the first draft when the redraft scores worse, and never recommends sending a failing draft @req FR:email-voice/score.ask', async () => {
    const { storage, ctx } = mkCtx();
    const worse = `${BAD}\n\nLet me know if you have any questions. We can leverage it.`;
    const s = setup([BAD, worse]);
    await runTriage({ ctx, ...s, rules, voice });
    expect(s.created[0].text).toContain('Best regards');
    expect(s.created[0].text).not.toContain('any questions');
    const a = await askOf(storage);
    expect(a.recommend).toBe('Edit then send');
    expect(a.detail).toMatch(/^Voice: \d+\/100 · fix: "hope this email finds you well"/i);
  });

  it('scores against the default profile when none is loaded @req FR:email-voice/score.none', async () => {
    const { storage, ctx } = mkCtx();
    const s = setup(['Thanks, Friday works.']);
    await runTriage({ ctx, ...s, rules });
    expect((await askOf(storage)).detail).toMatch(/^Voice: no profile yet\n\nThanks, Friday works\./);
  });
});

// @req FR:email-voice/score.ask
describe('toAsk voice line', () => {
  const r = (over: Partial<NonNullable<TriageResult['draft']>> = {}): TriageResult => ({
    message: msg(), class: 'needs_reply', confidence: 0.95, draft: { text: GOOD, webLink: 'https://outlook.example.test/d', voice: { score: 60, pass: false, violations: [], profile: true }, ...over },
  });
  it('downgrades the recommendation for a failing draft even at high confidence', () => {
    expect(toAsk(r())?.recommend).toBe('Edit then send');
    expect(toAsk(r({ voice: { score: 92, pass: true, violations: [], profile: true } }))?.recommend).toBe('Send as drafted');
  });
});
