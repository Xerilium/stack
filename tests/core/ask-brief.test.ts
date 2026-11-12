import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BRIEF_MAX_WORDS, briefWords, checkBrief, formatBriefLines, needsBrief, parseBriefLines } from '../../src/core/ask-brief';
import { formatAsk, listAsks, parseAsk, putAsk, readAsk } from '../../src/core/asks';
import { answerNeed, NEEDS_PATH, readNeeds } from '../../src/core/needs-you';
import { briefWarnings, parseReport, ReportInvalid, ReportStore } from '../../src/core/reports';
import { MemoryStorage } from '../../src/core/storage';
import { LifecycleError } from '../../src/core/lifecycle';
import { createApiHandler } from '../../src/api/handler';
import { run } from '../../src/cli/run';
import { parseEscalations, PrPriInvalid } from '../../src/core/pr-priority';
import { parseQueue } from '../../src/core/pr-board';

const NOW = new Date('2026-11-12T18:00:00Z');
const BRIEF = {
  problem: 'PR 130 adds status ingest. Agents cannot send status without it.',
  solution: 'Merge PR 130 to main. Agents then call stack report.',
  risks: ['The report store is new and has no migration.', 'A bad report can hide an ask.'],
  recommendation: 'Approve. CI is green and tests cover the store.',
  evidence: ['https://github.com/Xerilium/stack/pull/130'],
};
const issuesOf = (raw: unknown) => checkBrief(raw).issues.map((i) => i.field);

describe('checkBrief', () => {
  // @req FR:ask-briefs/$brief @req FR:ask-briefs/brief.validate
  it('accepts a valid brief and trims each line', () => {
    const r = checkBrief({ ...BRIEF, problem: `  ${BRIEF.problem}  ` });
    expect(r.issues).toEqual([]);
    expect(r.brief).toEqual(BRIEF);
    expect(briefWords(r.brief!)).toBeLessThanOrEqual(BRIEF_MAX_WORDS);
    const noEvidence = { problem: BRIEF.problem, solution: BRIEF.solution, risks: BRIEF.risks, recommendation: BRIEF.recommendation };
    expect(checkBrief(noEvidence).brief).toEqual(noEvidence);
  });

  // @req FR:ask-briefs/brief.validate
  it('names every issue: missing, unknown, bad links, line breaks, and risk count', () => {
    expect(issuesOf({})).toEqual(['brief.problem', 'brief.solution', 'brief.recommendation', 'brief.risks']);
    expect(issuesOf({ ...BRIEF, extra: 1 })).toEqual(['brief.extra']);
    expect(issuesOf({ ...BRIEF, evidence: ['http://x.test', 'javascript:alert(1)'] })).toEqual(['brief.evidence[0]', 'brief.evidence[1]']);
    expect(issuesOf({ ...BRIEF, problem: 'a\nb' })).toEqual(['brief.problem']);
    expect(issuesOf({ ...BRIEF, risks: [] })).toEqual(['brief.risks']);
    expect(issuesOf({ ...BRIEF, risks: ['a', 'b', 'c', 'd', 'e', 'f'] })).toEqual(['brief.risks']);
    expect(issuesOf('text')).toEqual(['brief']);
  });

  // @req FR:ask-briefs/brief.validate
  it('enforces Simplified Technical English: 25 words per sentence and 120 words in all', () => {
    const long = Array.from({ length: 26 }, (_, i) => `w${i}`).join(' ');
    expect(issuesOf({ ...BRIEF, solution: `${long}.` })).toEqual(['brief.solution']);
    expect(checkBrief({ ...BRIEF, solution: `${long.split(' ').slice(0, 13).join(' ')}. ${long.split(' ').slice(13).join(' ')}.` }).brief).toBeDefined();
    const twenty = Array.from({ length: 20 }, () => 'word').join(' ');
    const r = checkBrief({ ...BRIEF, problem: `${twenty}. ${twenty}. ${twenty}.`, solution: `${twenty}. ${twenty}.`, risks: [`${twenty}.`] });
    expect(r.brief).toBeUndefined();
    expect(r.issues[0]).toEqual({ field: 'brief', message: expect.stringMatching(/at most 120 words/) });
  });

  // @req FR:ask-briefs/brief.lint
  it('needsBrief is true only for approve and decide asks with no brief', () => {
    expect(needsBrief('approve', undefined)).toBe(true);
    expect(needsBrief('decide', undefined)).toBe(true);
    expect(needsBrief('approve', BRIEF)).toBe(false);
    expect(needsBrief('review', undefined)).toBe(false);
    expect(needsBrief('answer', undefined)).toBe(false);
  });

  // @req FR:ask-briefs/brief.store
  it('round-trips as ## Brief lines', () => {
    expect(parseBriefLines(formatBriefLines(BRIEF))).toEqual(BRIEF);
    expect(parseBriefLines(['- problem: only a problem'])).toBeUndefined();
    expect(parseBriefLines([])).toBeUndefined();
  });
});

describe('brief on ask files', () => {
  const mk = () => { const storage = new MemoryStorage(); return { storage, ctx: { storage, now: () => NOW } }; };
  const base = { ask: 'Approve merging PR 130', kind: 'approve' as const, from: 'xe-cos' };

  // @req FR:ask-briefs/brief.store @req FR:ask-briefs/brief.api
  it('stores the brief under ## Brief and lists it', async () => {
    const { ctx, storage } = mk();
    await putAsk(ctx, 'pr-130', { ...base, brief: BRIEF, detail: 'More notes' }, 'xe-cos');
    const file = (await storage.read('tasks/asks/pr-130.md')).content;
    expect(file).toContain('## Brief\n\n- problem: PR 130 adds status ingest.');
    expect(file).toContain('- risk: A bad report can hide an ask.');
    expect(file.indexOf('## Brief')).toBeLessThan(file.indexOf('## Detail'));
    expect((await readAsk(ctx, 'pr-130'))!.ask.brief).toEqual(BRIEF);
    expect((await listAsks(ctx)).items[0].brief).toEqual(BRIEF);
    // an update without a brief keeps it
    await putAsk(ctx, 'pr-130', { why: 'CI green' }, 'xe-cos');
    expect((await readAsk(ctx, 'pr-130'))!.ask.brief).toEqual(BRIEF);
    const a = parseAsk('pr-130', file);
    expect(parseAsk('pr-130', formatAsk(a))).toEqual(a);
  });

  // @req FR:ask-briefs/brief.validate
  it('rejects a bad brief and escapes markdown in brief text', async () => {
    const { ctx } = mk();
    await expect(putAsk(ctx, 'k', { ...base, brief: { ...BRIEF, risks: [] } }, 'cos')).rejects.toThrow(LifecycleError);
    await putAsk(ctx, 'k2', { ...base, brief: { ...BRIEF, problem: 'See [this](https://evil.test) <b>now</b>.' } }, 'cos');
    expect((await readAsk(ctx, 'k2'))!.ask.brief!.problem).toBe('See (this)(https://evil.test) ‹b›now‹/b›.');
  });

  // @req FR:ask-briefs/brief.api
  it('POST /asks/{key} takes brief and rejects a bad one (422)', async () => {
    const { storage } = mk();
    const h = createApiHandler({ storage, authorize: () => true, now: () => NOW });
    const post = (body: unknown) => h(new Request('https://x.test/api/asks/pr-130', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    expect((await post({ ...base, brief: BRIEF })).status).toBe(200);
    const list = await (await h(new Request('https://x.test/api/asks', { method: 'GET' }))).json() as { items: { brief?: unknown }[] };
    expect(list.items[0].brief).toEqual(BRIEF);
    const bad = await post({ ...base, brief: { problem: 'x' } });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { error: { details: { field: string }[] } }).error.details.map((d) => d.field)).toContain('brief.solution');
  });
});

describe('brief on report asks', () => {
  const ASK = { id: 'pr-130', ask: 'Approve PR 130', link: 'https://github.com/Xerilium/stack/pull/130', by: '2026-11-13T17:00:00Z', kind: 'approve' };

  // @req FR:ask-briefs/brief.report
  it('parseReport keeps a valid brief and lists brief issues with the ask path', () => {
    expect(parseReport({ agent: 'a', project: 'p', asks: [{ ...ASK, brief: BRIEF }] }).asks[0].brief).toEqual(BRIEF);
    try { parseReport({ agent: 'a', project: 'p', asks: [{ ...ASK, brief: { ...BRIEF, recommendation: undefined } }] }); throw new Error('no throw'); }
    catch (e) { expect((e as ReportInvalid).issues.map((i) => i.field)).toEqual(['asks[0].brief.recommendation']); }
  });

  // @req FR:ask-briefs/brief.needs @req FR:ask-briefs/brief.lint
  it('carries agent, kind and brief into Needs you; warns on approve asks with none', async () => {
    const store = new ReportStore(mkdtempSync(join(tmpdir(), 'stack-home-')), { now: () => NOW });
    await store.put({ agent: 'xe-cos', project: 'stack', asks: [{ ...ASK, brief: BRIEF }, { ...ASK, id: 'pr-131', ask: 'Approve PR 131' }, { ...ASK, id: 'pr-132', kind: 'review' }] });
    const needs = store.needs();
    expect(needs[0]).toMatchObject({ id: 'rp.xe-cos.stack.pr-130', from: 'xe-cos', askKind: 'approve', brief: BRIEF });
    expect(needs[1].brief).toBeUndefined();
    const w = briefWarnings(parseReport({ agent: 'xe-cos', project: 'stack', asks: [{ ...ASK, brief: BRIEF }, { ...ASK, id: 'pr-131' }, { ...ASK, id: 'pr-132', kind: 'review' }] }));
    expect(w).toEqual([expect.stringMatching(/^asks pr-131 \(approve\) has no brief/)]);
  });

  // @req FR:ask-briefs/context.need
  it('records a context answer and returns it to the agent; it is kept until the next answer', async () => {
    const store = new ReportStore(mkdtempSync(join(tmpdir(), 'stack-home-')), { now: () => NOW });
    await store.put({ agent: 'xe-cos', project: 'stack', asks: [ASK] });
    await store.answer('rp.xe-cos.stack.pr-130', { choice: 'context' });
    const r = await store.put({ agent: 'xe-cos', project: 'stack', asks: [{ ...ASK, brief: BRIEF }] });
    expect(r.asks.answers['rp.xe-cos.stack.pr-130']).toEqual({ choice: 'context', at: NOW.toISOString() });
    expect(store.needs()[0]).toMatchObject({ brief: BRIEF, answer: { choice: 'context' } });
  });
});

describe('brief on Chief of Staff items', () => {
  // @req FR:ask-briefs/brief.needs @req FR:ask-briefs/context.need
  it('reads a valid brief and from; drops a bad brief; takes a context answer', async () => {
    const storage = new MemoryStorage();
    const items = [
      { id: 'n1', title: 'Approve PR 879', recommendation: 'Approve', link: 'https://github.com/o/r/pull/879', from: 'allyte-cos', brief: BRIEF },
      { id: 'n2', title: 'Approve PR 880', recommendation: 'Approve', link: 'https://github.com/o/r/pull/880', brief: { problem: 'x' } },
    ];
    await storage.writeAux(NEEDS_PATH, JSON.stringify({ items }), { expectedVersion: null });
    const got = await readNeeds(storage);
    expect(got[0]).toMatchObject({ id: 'n1', from: 'allyte-cos', brief: BRIEF });
    expect(got[1].brief).toBeUndefined();
    await answerNeed(storage, 'n2', { choice: 'context' }, NOW);
    expect((await readNeeds(storage))[1].answer).toEqual({ choice: 'context', at: NOW.toISOString() });
  });
});

describe('stack CLI lint', () => {
  // @req FR:ask-briefs/brief.lint @req FR:ask-briefs/brief.cli
  it('report: stores an approve ask with no brief, exit 0, and prints a warning', async () => {
    const home = mkdtempSync(join(tmpdir(), 'stack-home-'));
    const cwd = mkdtempSync(join(tmpdir(), 'stack-norepo-'));
    process.env.STACK_HOME = home;
    try {
      let out = '';
      const body = { asks: [{ id: 'pr-130', ask: 'Approve PR 130', link: 'https://github.com/o/r/pull/130', by: '2026-11-13', kind: 'approve' }] };
      const code = await run(['report', '--agent', 'xe-cos', '--project', 'stack', '--dir', cwd], { out: (s) => { out += s; }, err: () => undefined, in: async () => JSON.stringify(body) });
      expect(code).toBe(0);
      expect(out).toMatch(/^report xe-cos\/stack: 1 asks, 0 dropped \(store\)\nwarning: asks pr-130 \(approve\) has no brief/);
      expect(JSON.parse(readFileSync(join(home, 'reports.json'), 'utf8')).reports['xe-cos/stack'].asks).toHaveLength(1);
    } finally { delete process.env.STACK_HOME; }
  });
});

describe('brief on PR escalations', () => {
  const entry = { pr: 'https://github.com/Xerilium/stack/pull/101', status: 'decide', exactBlocker: 'Keep the old API?', context: 'Two callers.', recommendedAnswer: 'Keep it' };
  // @req FR:ask-briefs/brief.pr
  it('escalate keeps a valid brief, rejects a bad one, and the board shows it', () => {
    const set = parseEscalations({ blockedAutopilot: [{ ...entry, brief: BRIEF }] });
    expect(set.blockedAutopilot[0].brief).toEqual(BRIEF);
    expect(() => parseEscalations({ blockedAutopilot: [{ ...entry, brief: { problem: 'x' } }] })).toThrow(PrPriInvalid);
    const q = parseQueue({ state: { escalations: set } });
    expect(q.escalations!.blocked[0].brief).toEqual(BRIEF);
    expect(parseQueue({ state: { escalations: { blockedAutopilot: [{ ...entry, brief: { problem: 'x' } }] } } }).escalations!.blocked[0].brief).toBeUndefined();
  });
});
