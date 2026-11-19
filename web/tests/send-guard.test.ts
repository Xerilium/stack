import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUDITED, findSends, overAudit, saySend, SENDERS } from '../src/ui/send-guard';

const SRC = new URL('../src/', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, SRC), 'utf8');
const views = (readdirSync(SRC, { recursive: true }) as string[]).map((f) => f.replace(/\\/g, '/')).filter((f) => f.endsWith('.tsx'));

describe('send guard', () => {
  // @req FR:ui-kit/send.guard @req FR:ui-kit/send.guard.fail @req FR:ui-kit/send.box @req FR:ui-kit/send.decision
  it('no element handler sends outside a form submit, except the audited decisions', () => {
    expect(overAudit(views.flatMap((f) => findSends(f, read(f))), AUDITED)).toEqual([]);
  });

  // @req FR:ui-kit/send.guard.audit
  it('the audit list names only files that still have a one-step send, each with its reason', () => {
    for (const [file, a] of Object.entries(AUDITED)) {
      expect(findSends(file, read(file)).length, `${file}: lower or remove its audit entry`).toBe(a.n);
      expect(a.why.length, file).toBeGreaterThan(20);
    }
  });

  // @req FR:ui-kit/send.guard.names
  it('knows every client method that gives text or a decision to an agent, a session, a person or GitHub', () => {
    for (const m of ['promptSession', 'newSession', 'send', 'assign', 'review', 'answerAsk', 'answerNeed', 'decideRec', 'inboxAct', 'prAck', 'prRec', 'feedback', 'designReview']) {
      expect(SENDERS, m).toContain(`api.${m}`);
      expect(read('api.ts'), m).toMatch(new RegExp(`\\b${m}: `));
    }
  });

  // @req FR:ui-kit/send.guard.fail
  it('flags a click, a key or a change that sends, direct or through a function of the file', () => {
    const src = `
      const ask = async () => { await api.promptSession(id, 'Add a task'); };
      const viaHook = useCallback(() => { void ask(); }, []);
      export const V = () => <>
        <button onClick={() => api.promptSession(id, 'ready text')}>Ask CoS</button>
        <button onClick={ask}>Ask</button>
        <button onClick={() => void viaHook()}>Ask again</button>
        <input onKeyDown={(e) => { if (e.key === 'Enter') onSend(text); }} />
        <select onChange={() => team.assign(ref)} />
      </>;`;
    expect(findSends('V.tsx', src).map((f) => [f.line, f.at, f.call])).toEqual([
      [5, 'button onClick', 'api.promptSession'], [6, 'button onClick', 'api.promptSession'], [7, 'button onClick', 'api.promptSession'], [8, 'input onKeyDown', 'onSend'], [9, 'select onChange', 'team.assign'],
    ]);
  });

  // @req FR:ui-kit/send.guard.fail @req FR:ui-kit/send.box
  it('allows a form submit, a handler that only fills the box, a component prop, and a like name on another object', () => {
    const src = `
      const send = async () => { await api.promptSession(id, text); };
      export const V = () => <>
        <form onSubmit={(e) => { e.preventDefault(); void send(); }}><textarea value={text} onInput={(e) => setText(e.target.value)} /><button type="submit">Send to Xe CoS</button></form>
        <button onClick={() => setText('ready text')}>Do it</button>
        <MessageBox onSend={(t) => api.promptSession(id, t)} />
        <button onClick={() => location.assign('/x')}>Sign in</button>
        <button onClick={() => steps.send({ step: 1 })}>Next</button>
      </>;`;
    expect(findSends('V.tsx', src)).toEqual([]);
  });

  // @req FR:ui-kit/send.guard.fail @req FR:ui-kit/send.guard.audit @req FR:ui-kit/send.guard.message
  it('a file keeps the count its audit entry names, and no more; the finding says what to do', () => {
    const one = { file: 'A.tsx', line: 3, at: 'button onClick', call: 'api.answerAsk' };
    expect(overAudit([one], { 'A.tsx': { n: 1, why: 'Approve sends a fixed decision' } })).toEqual([]);
    expect(overAudit([one, { ...one, line: 9 }], { 'A.tsx': { n: 1, why: 'Approve sends a fixed decision' } })).toHaveLength(1);
    expect(overAudit([one], {})).toEqual([saySend('A.tsx', [one], 0)]);
    expect(saySend('A.tsx', [one], 0)).toBe('A.tsx: 1 one-step sends (allowed 0): line 3 button onClick calls api.answerAsk. Send from a form: show the text in a box (web/src/ui/MessageBox.tsx) and name the effect on the submit button.');
  });
});
