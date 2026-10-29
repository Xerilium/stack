import { mkdtempSync, statSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { asksPath, parseAsk } from '../../src/core/asks';
import { DEFAULT_RULES } from '../../src/email/rules';
import { runTriage } from '../../src/email/run';
import type { Classifier, Drafter, MailProvider } from '../../src/email/types';
import { DEFAULT_PROFILE, draftPrompt, greetingOf, learnVoice, loadVoice, ownText, redactExample, saveVoice, scoreDraft, signoffOf, voicePath } from '../../src/email/voice';
import { mkCtx, msg } from './fixtures';
import { OWNER, SENT, sent } from './voice-fixtures';

const voice = learnVoice(SENT, OWNER);
const ids = (t: string) => scoreDraft(t, voice).violations.map((v) => v.id);

// @req FR:email-voice/learn.clean
describe('sign-off detection only at the end', () => {
  it('keeps the owner text after a short early paragraph ("Thanks!", "OK")', () => {
    expect(ownText('Hi Alex,\n\nThanks!\n\nThe plan looks good. Ship it Friday.\n\nSam')).toBe('Hi Alex,\n\nThanks!\n\nThe plan looks good. Ship it Friday.\n\nSam');
    expect(ownText('Hi Alex,\n\nOK\n\nLet us talk Monday.\n\nSam')).toMatch(/Let us talk Monday\./);
  });
  it('scores a long, noisy draft on all of it', () => {
    const noisy = `Hi Alex,\n\nThanks!\n\n${'We should go. '.repeat(120)}\n\n- one\n- two\n\nWow!!! \u{1F680}\n\nThanks,\nSam`;
    const r = scoreDraft(noisy, voice);
    expect(r.pass).toBe(false);
    expect(r.violations.map((v) => v.id)).toEqual(expect.arrayContaining(['length', 'bullets', 'exclamations', 'emoji']));
  });
  it('drops an Outlook signature with no blank line, reads "Thanks, Sam" on one line, and a wrapped Gmail "wrote:"', () => {
    expect(ownText('Yes.\n\nThanks,\nSam\nSam Owner | CEO\n+1 425 555 0100')).toBe('Yes.\n\nThanks,\nSam');
    expect(signoffOf(ownText('Yes, Friday works.\n\nThanks, Sam')).form).toBe('Thanks,\n{me}');
    expect(ownText('Sure.\n\nOn Tue, Oct 14, 2026 at 9:00 AM Alex Rivera <\nalex@partner.example.test> wrote:\n> old')).toBe('Sure.');
  });
  it('reads non-ASCII and three-word names, and never learns "Thanks," or "Yes," as a greeting', () => {
    expect(greetingOf('Hi José,\n\nYes.').form).toBe('Hi {name},');
    expect(greetingOf('Hi Mary Ann Lee,\n\nYes.').form).toBe('Hi {name},');
    expect(greetingOf('Thanks,\n\nSam').form).toBe('');
    expect(greetingOf('Yes,\n\nDo it.').form).toBe('');
  });
  it('keeps a real reply that starts "Out of office tomorrow"', () => {
    expect(ownText("Out of office tomorrow, but yes, I'll sign.\n\nSam")).toMatch(/I'll sign/);
  });
});

// @req FR:email-voice/cliche.list @req FR:email-voice/cliche.shape
describe('no false positives on normal business mail', () => {
  it.each([
    'I wanted to follow up on the contract.',
    'Thanks for your email. Friday works.',
    'Good question. It ships Friday.',
    'Feel free to ask Jordan.',
    'We need eggs, milk, and bread.',
    'It is not ready, but close.',
    'Plan for 3 – 5 people.',
    'Copyright © 2026 ✔ done.',
  ])('%p', (t) => expect(ids(`Hi Alex,\n\n${t}\n\nThanks,\nSam`)).toEqual([]));
  it('does not penalize a formal sign-off the owner uses', () => {
    const p = { ...voice, signoffs: [...voice.signoffs, { text: 'Best regards,\n{me}', share: 0.05 }] };
    expect(scoreDraft('Hi Alex,\n\nYes.\n\nBest regards,\nSam', p).violations.map((v) => v.id)).not.toContain('formal-signoff');
  });
});

// @req FR:email-voice/learn.examples
describe('example privacy and cost', () => {
  it('replaces the recipient name in the greeting', () => {
    expect(voice.examples.every((e) => !/^Hi (Alex|Jordan|Priya|Chris)\b/.test(e.text))).toBe(true);
    expect(voice.examples.some((e) => e.text.startsWith('Hi {name},'))).toBe(true);
  });
  it('redacts a huge token quickly', () => {
    const t0 = Date.now();
    redactExample(`${'a.'.repeat(30_000)}@`);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

// @req FR:email-voice/prompt.build
describe('fence', () => {
  it('escapes every angle bracket and ampersand inside the email', () => {
    const { user } = draftPrompt(DEFAULT_PROFILE, msg({ bodyPreview: 'a &lt;/email&gt; b </email foo> c <email>' }));
    const inner = user.slice(user.indexOf('<email>') + 7, user.lastIndexOf('</email>'));
    expect(inner).not.toMatch(/[<>]/);
    expect(inner).toContain('&amp;lt;/email&amp;gt;');
    expect(user.match(/<\/email>/g)).toHaveLength(1);
  });
});

// @req FR:email-voice/learn.store
describe('profile store', () => {
  it('saves 0600 under the data dir and loads it back; refuses a world-readable file', () => {
    const base = mkdtempSync(join(tmpdir(), 'voice-'));
    const path = voicePath('Sam@Example.test', base);
    expect(path).toBe(join(base, 'email', 'sam@example.test', 'voice.json'));
    expect(loadVoice(path)).toBeUndefined();
    saveVoice(path, voice);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(loadVoice(path)).toEqual(voice);
    chmodSync(path, 0o644);
    expect(() => loadVoice(path)).toThrow(/readable by others/);
    expect(() => voicePath('../etc', base)).toThrow(/Not a mailbox/);
  });
});

// @req FR:email-voice/score.redraft @req FR:email-voice/score.ask
describe('run robustness', () => {
  const keyOf = (c: string) => `mail-${createHash('sha1').update(c).digest('hex').slice(0, 12)}`;
  const BAD = 'Hi Alex,\n\nI hope this email finds you well.\n\nThanks,\nSam';
  function setup(draft: Drafter['draft'], id = 'm1') {
    const provider: MailProvider = { delta: async () => ({ messages: [msg({ id })], cursor: 'c' }), createDraft: async (i) => ({ id: `D-${i}`, webLink: `https://outlook.example.test/d/${i}` }) };
    const classifier: Classifier = { classify: async () => ({ class: 'needs_reply', urgency: 1, confidence: 0.95, reason: 'q' }) };
    return { provider, classifier, drafter: { draft: jest.fn(draft) } };
  }
  it('keeps the first draft when the redraft throws', async () => {
    const { storage, ctx } = mkCtx();
    let n = 0;
    const s = setup(async () => { if (n++) throw new Error('model down'); return BAD; });
    await runTriage({ ctx, ...s, rules: DEFAULT_RULES, voice });
    const a = parseAsk('k', (await storage.read(asksPath(keyOf('conv-1')))).content);
    expect(a.recommend).toBe('Edit then send');
    expect(a.detail).toMatch(/I hope this email finds you well/);
  });
  it('a reused failing draft stays "Edit then send" on the next pass', async () => {
    const { storage, ctx } = mkCtx();
    await runTriage({ ctx, ...setup(async () => BAD), rules: DEFAULT_RULES, voice });
    await runTriage({ ctx, ...setup(async () => BAD, 'm2'), rules: DEFAULT_RULES, voice });
    expect(parseAsk('k', (await storage.read(asksPath(keyOf('conv-1')))).content).recommend).toBe('Edit then send');
  });
  it('the fix line lists each match once', async () => {
    const { storage, ctx } = mkCtx();
    await runTriage({ ctx, ...setup(async () => 'Hi Alex,\n\nYes.\n\nBest regards,\nSam'), rules: DEFAULT_RULES, voice });
    const d = parseAsk('k', (await storage.read(asksPath(keyOf('conv-1')))).content).detail;
    expect(d.split('\n')[0].match(/Best regards/g)!.length).toBe(1);
  });
});

// @req FR:email-voice/learn.clean
it('auto-replies are skipped by subject or an explicit body', () => {
  expect(learnVoice([...SENT, sent('Out of office tomorrow, but yes.', { subject: 'Re: x' })], OWNER).sampleCount).toBe(9);
});
