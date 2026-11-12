import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseConfig } from '../../src/core/config';
import { parseProject } from '../../src/core/parser';
import { listEngines, rankTasks, toScoringProject } from '../../src/core/scoring';
import { autopriEngine, checkMisses, parseMisses, pickMatch } from '../../src/core/autopri';
import { parseTruth } from '../../src/core/autopri-tags';
import { parsePris, PrisInvalid, type Pri } from '../../src/core/pris';
import {
  formatGaps, isoWeek, linkCounts, linkTask, PRI_SCORE, priGaps, prisEngine, prisParts, registerPrisEngine, setPris, weekStart, withLinks, withNote,
} from '../../src/core/pris-rank';

const FIX = join(__dirname, '../fixtures/pris-aware-ranking');
const config = parseConfig();
const load = (dir: string) => readdirSync(dir).filter((n) => n.endsWith('.md')).sort()
  .map((n) => toScoringProject(parseProject(readFileSync(join(dir, n), 'utf8')), n.replace(/\.md$/, '')));
const mk = (name: string, lines: string[], aliases = '') => toScoringProject(parseProject(`# ${name}\n\n${aliases ? `- **Aliases:** ${aliases}\n` : ''}- **Project value:** 💰\n\n## 🔄 Active\n\n${lines.map((l) => `- [ ] ${l}`).join('\n')}\n`), name.toLowerCase());
const pri = (id: string, o: Partial<Pri> = {}): Pri => ({ id, title: id.toUpperCase(), status: 'active', items: [], backlog: [], weekly: [], ...o });
const row = (text: string, o: { context?: string; project?: string; aliases?: string[] } = {}) => ({ text, project: o.project ?? 'Other', aliases: o.aliases ?? [], ...(o.context ? { context: o.context } : {}) });
const rank = (engine: typeof autopriEngine, projects: ReturnType<typeof load>, at: Date) => rankTasks(engine, projects, config, at, { ignoreBlocks: true }).map((s) => s.task.text);
const fixturePris = (): Pri[] => parsePris(JSON.parse(readFileSync(join(FIX, 'pris.json'), 'utf8')).pris);
afterEach(() => setPris([]));

describe('pris link fields', () => {
  // @req FR:pris-aware-ranking/link.model
  it('accepts projects, keywords, refs and statusAt; rejects bad values and other unknown keys', () => {
    const ok = parsePris([{ ...pri('p1'), projects: ['ftk'], keywords: ['v16'], refs: ['draft PR'], statusAt: '2026-11-11T10:00:00Z' }]);
    expect(ok[0]).toMatchObject({ projects: ['ftk'], keywords: ['v16'], refs: ['draft PR'], statusAt: '2026-11-11T10:00:00Z' });
    expect(parsePris([pri('p1')])[0]).not.toHaveProperty('keywords');
    const bad = (o: Record<string, unknown>) => { try { parsePris([{ ...pri('p1'), ...o }]); return []; } catch (e) { return (e as PrisInvalid).issues.map((i) => i.field); } };
    expect(bad({ keywords: 'v16' })).toEqual(['[0].keywords']);
    expect(bad({ refs: [''] })).toEqual(['[0].refs[0]']);
    expect(bad({ projects: Array(21).fill('x') })).toEqual(['[0].projects']);
    expect(bad({ keywords: ['x'.repeat(101)] })).toEqual(['[0].keywords[0]']);
    expect(bad({ statusAt: 'yesterday' })).toEqual(['[0].statusAt']);
    expect(bad({ tags: [] })).toEqual(['[0].tags']);
  });
});

describe('linkTask', () => {
  // @req FR:pris-aware-ranking/link.@function @req FR:pris-aware-ranking/$pri-link
  // @req FR:pris-aware-ranking/link.ref @req FR:pris-aware-ranking/link.keyword @req FR:pris-aware-ranking/link.project
  it('links by ref (own text), keyword (text or context) and project (name or alias)', () => {
    const pris = [pri('a', { refs: ['draft PR'] }), pri('b', { keywords: ['v16'] }), pri('c', { projects: ['ftk'] })];
    expect(linkTask(pris, row('Publish one draft PR'))).toMatchObject({ id: 'a', rank: 1, via: 'ref', term: 'draft PR', boost: PRI_SCORE });
    expect(linkTask(pris, row('Child', { context: 'Draft PR work' }))).toBeUndefined(); // refs never match context
    expect(linkTask(pris, row('Review PRs', { context: 'Release v16' }))).toMatchObject({ id: 'b', via: 'keyword', boost: (PRI_SCORE * 2) / 3 });
    expect(linkTask(pris, row('Anything', { project: 'FinOps toolkit', aliases: ['FTK'] }))).toMatchObject({ id: 'c', via: 'project', boost: PRI_SCORE / 3 / 2 });
    expect(linkTask(pris, row('v160 is not v16x'))).toBeUndefined(); // whole words only
  });
  // @req FR:pris-aware-ranking/link.active
  it('links only active and blocked priorities; rank counts only those', () => {
    const pris = [pri('a', { status: 'paused', keywords: ['x'] }), pri('b', { status: 'done', keywords: ['x'] }), pri('c', { status: 'blocked', keywords: ['y'] }), pri('d', { keywords: ['x'] })];
    expect(linkTask(pris, row('x'))).toMatchObject({ id: 'd', rank: 2 });
    expect(linkTask(pris, row('y'))).toMatchObject({ id: 'c', rank: 1, boost: PRI_SCORE });
  });
  // @req FR:pris-aware-ranking/link.best
  it('keeps the highest boost, then the higher priority', () => {
    const pris = [pri('a', { projects: ['ftk'] }), pri('b', { keywords: ['v16'] }), pri('c', { keywords: ['v16'] })];
    expect(linkTask(pris, row('v16 PRs', { project: 'ftk' }))).toMatchObject({ id: 'b', via: 'keyword' }); // 2000 keyword > 1500 project
    expect(linkTask([pri('a', { keywords: ['x'] }), pri('b', { keywords: ['x'] })], row('x'))).toMatchObject({ id: 'a' });
  });
  // @req FR:pris-aware-ranking/link.auto
  it('takes project names and version tokens from the title when no terms are set', () => {
    const pris = [pri('p9', { title: 'Catalyst 0.3.4 / 0.4' }), pri('p5', { title: 'FTK 16' })];
    expect(linkTask(pris, row('Ship 0.3.4'))).toMatchObject({ id: 'p9', via: 'keyword', term: '0.3.4' });
    expect(linkTask(pris, row('Ship v0.4'))).toBeUndefined(); // `0.4` is not in `v0.4`
    expect(linkTask(pris, row('Chore', { project: 'Catalyst' }))).toMatchObject({ id: 'p9', via: 'project' });
    expect(linkTask(pris, row('Nov 16 review', { project: 'FinOps toolkit', aliases: ['ftk'] }))).toMatchObject({ id: 'p5', via: 'project' }); // `16` is not a token
    expect(linkTask([pri('x', { title: 'FTK 16', keywords: ['blog'] })], row('Chore', { project: 'ftk' }))).toBeUndefined(); // explicit terms turn auto off
  });
});

describe('pris engine', () => {
  // @req FR:pris-aware-ranking/engine.@function
  it('registers once and is not the default', () => {
    registerPrisEngine(); registerPrisEngine();
    expect(listEngines().filter((i) => i === 'pris')).toHaveLength(1);
    expect(listEngines()[0]).not.toBe('pris');
  });
  // @req FR:pris-aware-ranking/engine.same
  it('equals autopri with no priorities', () => {
    const projects = load(join(FIX, 'tasks'));
    const at = new Date('2026-11-11T17:00:00Z');
    expect(rank(prisEngine, projects, at)).toEqual(rank(autopriEngine, projects, at));
  });
  // @req FR:pris-aware-ranking/engine.score @req FR:pris-aware-ranking/engine.boost
  it('adds pri to the autopri parts and orders linked tasks by priority rank', () => {
    const projects = [mk('A', ['Plain ‼️ ⬆️ 💰 🟢', 'Second pri 🟡', 'First pri 🟡'])];
    const pris = [pri('p1', { keywords: ['First pri'] }), pri('p2', { keywords: ['Second pri'] })];
    setPris(pris);
    expect(rank(prisEngine, projects, new Date('2026-11-11T00:00:00Z'))).toEqual(['First pri 🟡', 'Second pri 🟡', 'Plain ‼️ ⬆️ 💰 🟢']);
    const parts = prisParts(autopriEngine.score(projects, config), projects, config, pris);
    const p = [...parts.values()].find((x) => x.link?.id === 'p2')!;
    expect(p.pri).toBe(PRI_SCORE / 2);
    const scored = rankTasks(prisEngine, projects, config, undefined).find((s) => s.task.text.startsWith('Second'))!;
    expect(scored.score).toBeCloseTo(p.unblock + p.urgency + p.value + p.pri);
  });
  // @req FR:pris-aware-ranking/engine.unblock
  it('keeps an unblocker above every linked task', () => {
    setPris([pri('p1', { keywords: ['pri'] })]);
    expect(rank(prisEngine, [mk('A', ['pri task 🚨 📅 Nov 11: 🟢', 'Enabler 🔓 ⚫️'])], new Date('2026-11-11T12:00:00Z'))[0]).toContain('Enabler');
  });
  // @req FR:pris-aware-ranking/engine.score
  it('lifts a blocker to the linked task it blocks', () => {
    setPris([pri('p1', { refs: ['Hot'] })]);
    const o = rank(prisEngine, [mk('A', ['Plain ‼️ ⬆️ 💰 🟢', 'Prep 🟡', 'Hot 🟡 -- after Prep'])], new Date('2026-11-11T12:00:00Z'));
    expect(o.indexOf('Prep 🟡')).toBeLessThan(o.indexOf('Plain ‼️ ⬆️ 💰 🟢'));
  });
  // @req FR:pris-aware-ranking/engine.memo
  it('changes its version only when the priorities change', () => {
    const v = prisEngine.version!();
    setPris([]);
    expect(prisEngine.version!()).toBe(v);
    setPris([pri('p1')]);
    expect(prisEngine.version!()).not.toBe(v);
  });
});

describe('gaps', () => {
  const NOW = new Date('2026-11-11T18:00:00Z');
  // @req FR:pris-aware-ranking/cos.gaps.@function @req FR:pris-aware-ranking/cos.gaps.kinds @req FR:pris-aware-ranking/$pri-gap
  it('lists no-status, stale (>7 days) and no-tasks for active and blocked priorities', () => {
    const pris = [
      pri('p1', { statusAt: '2026-11-10T09:00:00Z' }),
      pri('p2'),
      pri('p3', { weekly: [{ week: '2026-W44', text: 'old' }] }),
      pri('p4', { status: 'paused' }),
      pri('p5', { status: 'blocked', statusAt: '2026-11-04T17:00:00Z' }),
    ];
    const g = priGaps(pris, new Map([['p1', 2], ['p3', 1], ['p5', 1]]), NOW);
    expect(g).toEqual([
      { id: 'p2', rank: 2, title: 'P2', gaps: ['no-status', 'no-tasks'], linked: 0 },
      { id: 'p3', rank: 3, title: 'P3', gaps: ['stale'], lastStatus: '2026-10-26T00:00:00.000Z', days: 16, linked: 1 },
    ]);
    expect(priGaps([pri('p1', { statusAt: '2026-11-03T17:00:00Z' })], new Map([['p1', 1]]), NOW)[0].gaps).toEqual(['stale']);
    // The newer of statusAt and the newest week counts.
    expect(priGaps([pri('p1', { statusAt: '2026-10-01T00:00:00Z', weekly: [{ week: '2026-W46', text: 'hand edit' }] })], new Map([['p1', 1]]), NOW)).toEqual([]);
  });
  // @req FR:pris-aware-ranking/cos.gaps.cli
  it('formats one line per gap with the next command', () => {
    expect(formatGaps([])).toBe('no gaps');
    expect(formatGaps([
      { id: 'p2', rank: 2, title: 'Two', gaps: ['no-status', 'no-tasks'], linked: 0 },
      { id: 'p3', rank: 3, title: 'Three', gaps: ['no-tasks'], lastStatus: 'x', days: 1, linked: 0 },
    ])).toBe('2. p2 Two: no-status, no-tasks -> stack pris note p2 "..."\n3. p3 Three: no-tasks [last 1d] -> stack pris link p3 --keywords "..."');
  });
  it('counts open linked tasks per priority', () => {
    const projects = [mk('A', ['x one', 'x two 🅿️', 'y'])];
    expect(linkCounts(autopriEngine.score(projects, config), projects, [pri('p1', { keywords: ['x'] }), pri('p2', { keywords: ['z'] })])).toEqual(new Map([['p1', 1]]));
  });
  it('computes ISO weeks', () => {
    expect(isoWeek(new Date('2026-11-11T12:00:00Z'))).toBe('2026-W46');
    expect(isoWeek(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');
    expect(isoWeek(new Date('2024-12-30T12:00:00Z'))).toBe('2025-W01');
    expect(weekStart('2026-W46').toISOString()).toBe('2026-11-09T00:00:00.000Z');
  });
});

describe('edits', () => {
  // @req FR:pris-aware-ranking/cos.link
  it('replaces and clears link lists; unknown id throws', () => {
    const p = withLinks([pri('p1', { keywords: ['old'] }), pri('p2')], 'p1', { keywords: ['new'], projects: ['ftk'] });
    expect(p[0]).toMatchObject({ keywords: ['new'], projects: ['ftk'] });
    expect(withLinks(p, 'p1', { keywords: [] })[0]).not.toHaveProperty('keywords');
    expect(() => withLinks(p, 'nope', {})).toThrow(/Unknown priority/);
  });
  // @req FR:pris-aware-ranking/cos.note
  it('sets statusAt and replaces this week entry, newest first', () => {
    const now = new Date('2026-11-11T18:00:00Z');
    const p = withNote([pri('p1', { weekly: [{ week: '2026-W46', text: 'a' }, { week: '2026-W45', text: 'b' }] })], 'p1', 'c', now);
    expect(p[0].statusAt).toBe(now.toISOString());
    expect(p[0].weekly).toEqual([{ week: '2026-W46', text: 'c' }, { week: '2026-W45', text: 'b' }]);
    expect(() => parsePris(p)).not.toThrow();
  });
});

describe('bake-off', () => {
  // @req FR:pris-aware-ranking/bakeoff.ground-truth
  it('keeps the owner ground truth 1-6 with priorities from the ground-truth table', () => {
    const truth = parseTruth(readFileSync(join(FIX, 'ground-truth.md'), 'utf8')).filter((t) => t.rank !== null);
    expect(truth).toHaveLength(6);
    const anchor = (w: string) => w.match(/(?<![\w.])(?:v\d+(?:\.\d+)*|\d+(?:\.\d+)+)(?!\w|\.\d)/g) ?? [w.split(/\s+/).slice(0, 3).join(' ')];
    setPris(truth.map((t) => pri(`g${t.rank}`, { title: t.work, keywords: anchor(t.work) })));
    const rows = rank(prisEngine, load(join(__dirname, '../fixtures/auto-priority/tasks')), new Date('2026-11-05T12:00:00Z')).map((text) => ({ text }));
    expect(checkMisses(rows, parseMisses(readFileSync(join(__dirname, '../fixtures/auto-priority/ground-truth.md'), 'utf8')))).toEqual([]);
  });
  // @req FR:pris-aware-ranking/bakeoff.fixture @req FR:pris-aware-ranking/bakeoff.picks
  it('hits more owner picks in the top 10 than autopri', () => {
    const pris = fixturePris();
    expect(pris.map((p) => p.id)).toEqual(Array.from({ length: 12 }, (_, i) => `p${i + 1}`));
    const picks = readFileSync(join(FIX, 'picks.md'), 'utf8').split('\n').flatMap((l) => /^- (.+)$/.exec(l)?.[1] ?? []);
    expect(picks).toHaveLength(10);
    const projects = load(join(FIX, 'tasks'));
    const at = new Date('2026-11-11T17:00:00Z');
    const a = pickMatch(rank(autopriEngine, projects, at).map((text) => ({ text })), picks);
    setPris(pris);
    const p = pickMatch(rank(prisEngine, projects, at).map((text) => ({ text })), picks);
    expect(p.hits.length).toBeGreaterThanOrEqual(8);
    expect(p.hits.length).toBeGreaterThan(a.hits.length);
    // The report shows the same numbers.
    const doc = readFileSync(join(__dirname, '../../docs/scoring-bakeoff-pris.md'), 'utf8');
    expect(doc).toContain(`| autopri | ${a.hits.length}/10 |`);
    expect(doc).toContain(`| pris | ${p.hits.length}/10 |`);
  });
});

describe('rank cache', () => {
  // @req FR:pris-aware-ranking/engine.memo
  it('never returns an order computed for other priorities', async () => {
    const { cpSync, mkdtempSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { FsStorage } = await import('../../src/core/storage');
    const { rankStack } = await import('../../src/core/lifecycle');
    const dir = mkdtempSync(join(tmpdir(), 'stack-memo-'));
    cpSync(join(FIX, 'tasks'), join(dir, 'tasks'), { recursive: true });
    registerPrisEngine();
    const ctx = { storage: new FsStorage(dir), config, engine: 'pris' };
    const at = new Date('2026-11-11T17:00:00Z');
    const top = async () => (await rankStack(ctx, at, 2))[1].text;
    setPris([pri('a', { keywords: ['Stack v2'] })]);
    expect(await top()).toContain('Stack v2');
    setPris([pri('a', { keywords: ['Clyde'] })]);
    expect(await top()).toContain('Clyde');
  });
});
