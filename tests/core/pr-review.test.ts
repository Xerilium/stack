import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  BriefInvalid, BriefStore, FactsStore, isSpecPath, isStale, lintBrief, needsLiveValidation, parsePrRef, sortBySpecLines, specLines, type Gh,
} from '../../src/core/pr-review';

const NOW = new Date('2026-11-11T18:00:00Z');
const home = () => mkdtempSync(join(tmpdir(), 'stack-prr-'));
const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);

describe('spec lines', () => {
  // @req FR:pr-review-lane/sort.lines
  it('counts additions and deletions in spec files only', () => {
    expect(isSpecPath('.xe/features/x/spec.md')).toBe(true);
    expect(isSpecPath('src/foo/spec.md')).toBe(true);
    expect(isSpecPath('docs/api/README.md')).toBe(true);
    expect(isSpecPath('docs/img.png')).toBe(false);
    expect(isSpecPath('src/core/x.ts')).toBe(false);
    expect(specLines([
      { filename: '.xe/features/a/spec.md', additions: 10, deletions: 2 },
      { filename: 'src/a.ts', additions: 500, deletions: 9 },
      { filename: 'docs/live.md', additions: 3, deletions: 0 },
    ])).toBe(15);
    expect(specLines([{ filename: 'src/a.ts', additions: 5, deletions: 5 }])).toBe(0);
    expect(specLines([])).toBe(0);
  });

  // @req FR:pr-review-lane/sort.order
  it('drops Autopilot rows, sorts fewest first, unknown last, stable ties', () => {
    const rows = [
      { url: 'u1', labels: [], specLines: 40 },
      { url: 'u2', labels: ['Status: 🤖 Autopilot'], specLines: 1 },
      { url: 'u3', labels: [], specLines: null },
      { url: 'u4', labels: ['status: 🤖️ autopilot'], specLines: 0 },
      { url: 'u5', labels: [], specLines: 5 },
      { url: 'u6', labels: [], specLines: 5 },
    ];
    expect(sortBySpecLines(rows).map((r) => r.url)).toEqual(['u5', 'u6', 'u1', 'u3']);
    expect(rows.map((r) => r.url)).toEqual(['u1', 'u2', 'u3', 'u4', 'u5', 'u6']);
  });
});

describe('live-validation flag', () => {
  // @req FR:pr-review-lane/flag.rule
  it.each([
    [{ labels: ['Needs Validation'], body: '', paths: [] }, true, 'label: Needs Validation'],
    [{ labels: ['live-validation'], body: '', paths: [] }, true, 'label: live-validation'],
    [{ labels: [], body: '- [ ] Live validation on the dev site', paths: [] }, true, 'body: live validation'],
    [{ labels: [], body: 'Please validate live before merge', paths: [] }, true, 'body: validate live'],
    [{ labels: [], body: '', paths: ['infra/main.bicep'] }, true, 'path: infra/main.bicep'],
    [{ labels: [], body: '', paths: ['deploy/run.ps1'] }, true, 'path: deploy/run.ps1'],
    [{ labels: [], body: '', paths: ['src/deployment/x.ts'] }, true, 'path: src/deployment/x.ts'],
    [{ labels: [], body: '', paths: ['.github/workflows/deploy-dev.yml'] }, true, 'path: .github/workflows/deploy-dev.yml'],
    [{ labels: ['bug'], body: 'Fixes a typo. No deploy impact.', paths: ['src/a.ts', 'docs/deployer.md'] }, false, undefined],
  ])('%j -> %s', (input, live, reason) => {
    const r = needsLiveValidation(input);
    expect(r.live).toBe(live);
    if (reason) expect(r.reasons).toContain(reason); else expect(r.reasons).toEqual([]);
  });
});

describe('refs', () => {
  it('parses owner/name#n and PR urls', () => {
    expect(parsePrRef('Xerilium/stack#12')).toEqual({ repo: 'Xerilium/stack', number: 12, url: 'https://github.com/Xerilium/stack/pull/12' });
    expect(parsePrRef('https://github.com/o/r/pull/7')).toEqual({ repo: 'o/r', number: 7, url: 'https://github.com/o/r/pull/7' });
    expect(parsePrRef('stack#1')).toBeNull();
    expect(parsePrRef('o/r#0')).toBeNull();
  });
});

/** A fake `gh` that answers the two reads and counts calls. */
function fakeGh(prs: Record<string, { sha: string; body?: string; labels?: string[]; files: { filename: string; additions: number; deletions: number }[]; fail?: boolean }>) {
  const calls: string[][] = [];
  const gh: Gh = async (args) => {
    calls.push(args);
    const path = args.find((a) => a.startsWith('repos/'))!;
    const m = /^repos\/([^/]+\/[^/]+)\/pulls\/(\d+)(\/files)?$/.exec(path)!;
    const p = prs[`${m[1]}#${m[2]}`];
    if (!p || p.fail) throw new Error('gh: not found');
    if (m[3]) return p.files.map((f) => JSON.stringify(f)).join('\n');
    return JSON.stringify({ head: { sha: p.sha }, body: p.body ?? null, labels: (p.labels ?? []).map((name) => ({ name })), title: `PR ${m[2]}`, draft: false, html_url: `https://github.com/${m[1]}/pull/${m[2]}` });
  };
  return { gh, calls };
}

describe('facts cache', () => {
  // @req FR:pr-review-lane/sort.cache
  it('reads files once per head SHA, keeps prior facts on failure, caps parallel reads', async () => {
    const h = home();
    const data = { 'o/r#1': { sha: SHA, labels: ['Needs Validation'], files: [{ filename: '.xe/x/spec.md', additions: 4, deletions: 1 }] }, 'o/r#2': { sha: SHA, files: [{ filename: 'src/a.ts', additions: 9, deletions: 0 }] } };
    const f = fakeGh(data);
    const store = new FactsStore(h, { now: () => NOW });
    const out = await store.fetch([parsePrRef('o/r#1')!, parsePrRef('o/r#2')!], f.gh);
    expect(out.map((x) => [x.number, x.specLines, x.live])).toEqual([[1, 5, true], [2, 0, false]]);
    expect(out[0]).toMatchObject({ headSha: SHA, reasons: ['label: Needs Validation'], url: 'https://github.com/o/r/pull/1', at: NOW.toISOString() });
    expect(f.calls.filter((c) => c.some((a) => a.endsWith('/files')))).toHaveLength(2);
    // Same head: no second files read.
    await store.fetch([parsePrRef('o/r#1')!], f.gh);
    expect(f.calls.filter((c) => c.some((a) => a.endsWith('/files')))).toHaveLength(2);
    // New head: files read again.
    data['o/r#1'].sha = SHA2; data['o/r#1'].files.push({ filename: 'docs/a.md', additions: 1, deletions: 0 });
    expect((await store.fetch([parsePrRef('o/r#1')!], f.gh))[0]).toMatchObject({ headSha: SHA2, specLines: 6 });
    // gh fails: prior facts stay.
    (data['o/r#1'] as { fail?: boolean }).fail = true;
    expect((await store.fetch([parsePrRef('o/r#1')!], f.gh))[0]).toMatchObject({ headSha: SHA2, specLines: 6 });
    expect(new FactsStore(h).get(parsePrRef('O/R#1')!)?.specLines).toBe(6);
    // Parallel cap.
    let live = 0; let peak = 0;
    const slow: Gh = async (args) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; return args.some((a) => a.endsWith('/files')) ? '' : JSON.stringify({ head: { sha: SHA }, body: '', labels: [], title: 't', draft: false }); };
    await new FactsStore(home()).fetch(Array.from({ length: 10 }, (_, i) => parsePrRef(`o/r#${i + 1}`)!), slow);
    expect(peak).toBeLessThanOrEqual(4);
  });
  it('offline uses the cache only', async () => {
    const f = fakeGh({});
    const out = await new FactsStore(home()).fetch([parsePrRef('o/r#1')!], f.gh, { offline: true });
    expect(out).toEqual([]);
    expect(f.calls).toHaveLength(0);
  });
});

const BRIEF = { problem: 'The deploy step fails on the dev site.', solution: 'Pin the CLI version in the workflow.', recommendation: 'Approve the run.', evidence: ['https://github.com/o/r/actions/runs/1'], headSha: SHA };

describe('briefs', () => {
  // @req FR:pr-review-lane/brief.lint
  it('rejects more than 120 words or a sentence over 20 words; links do not count', () => {
    expect(lintBrief(BRIEF)).toEqual({ ok: true, words: 18, issues: [] });
    const long = Array.from({ length: 13 }, () => 'Short words make this sentence.').join(' ');
    const r = lintBrief({ ...BRIEF, problem: long, solution: long });
    expect(r.ok).toBe(false);
    expect(r.issues.join('\n')).toMatch(/over 120 words/);
    const s = lintBrief({ ...BRIEF, solution: Array.from({ length: 21 }, () => 'word').join(' ') + '.' });
    expect(s.ok).toBe(false);
    expect(s.issues.join('\n')).toMatch(/sentence over 20 words/);
  });

  // @req FR:pr-review-lane/brief.stale
  it('is stale only when a known head differs', () => {
    expect(isStale({ headSha: SHA }, SHA)).toBe(false);
    expect(isStale({ headSha: SHA }, SHA2)).toBe(true);
    expect(isStale({ headSha: SHA }, undefined)).toBe(false);
    expect(isStale({ headSha: SHA.slice(0, 7) }, SHA)).toBe(false);
  });

  // @req FR:pr-review-lane/brief.model
  it('stores one brief per PR, validates fields, writes atomically', async () => {
    const h = home();
    const s = new BriefStore(h, { now: () => NOW });
    const ref = parsePrRef('o/r#5')!;
    const r = await s.put(BRIEF, ref, 'fh-agent');
    expect(r.words).toBe(18);
    expect(r.brief).toMatchObject({ repo: 'o/r', number: 5, url: 'https://github.com/o/r/pull/5', askedAt: NOW.toISOString(), by: 'fh-agent' });
    await s.put({ ...BRIEF, recommendation: 'Reject it.' }, ref);
    expect(s.read()).toHaveLength(1);
    expect(s.get(ref)?.recommendation).toBe('Reject it.');
    expect(JSON.parse(readFileSync(join(h, 'pr-briefs.json'), 'utf8')).version).toBe(1);
    expect(existsSync(join(h, 'pr-briefs.lock'))).toBe(false);
    for (const bad of [{ ...BRIEF, evidence: [] }, { ...BRIEF, evidence: ['http://x'] }, { ...BRIEF, headSha: 'zz' }, { ...BRIEF, problem: '' }, { ...BRIEF, problem: 'a\nb' }, { ...BRIEF, askedAt: 'nope' }]) {
      await expect(s.put(bad, ref)).rejects.toBeInstanceOf(BriefInvalid);
    }
    writeFileSync(join(h, 'pr-briefs.json'), 'not json');
    expect(new BriefStore(h).read()).toEqual([]);
  });
});
