import { cpSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { rankStack, nextTask, type LifecycleContext } from '../../src/core/lifecycle';
import { getDefaults, parseConfig } from '../../src/core/config';
import { FsStorage } from '../../src/core/storage';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';

const FIX = join(__dirname, '../fixtures/rank-2026-11-01');
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const ctxOf = (priorities?: string | null): LifecycleContext => {
  const d = mkdtempSync(join(tmpdir(), 'stack-rank-')); dirs.push(d);
  cpSync(FIX, d, { recursive: true });
  if (priorities === null) rmSync(join(d, '.stack/priorities.json'));
  else if (priorities !== undefined) writeFileSync(join(d, '.stack/priorities.json'), priorities);
  const cfgPath = join(d, '.xe/config/stack.json');
  const config = existsSync(cfgPath) ? parseConfig(JSON.parse(readFileSync(cfgPath, 'utf8').replace(/^﻿/, ''))) : getDefaults();
  mkdirSync(join(d, 'tasks'), { recursive: true });
  return { storage: new FsStorage(d), config, engine: 'stack' } as LifecycleContext;
};
const AT = new Date('2026-11-01T22:00:00-07:00'); // Sunday evening, the day Michael looked
/** Top-level rows in rank order: what a surface that shows rows (Home) draws. */
const rootsOf = (r: { ref: { path: string; line: number; text?: string }; root?: { path: string; line: number; text?: string } }[]) => [...new Map(r.map((x) => [(x.root ?? x.ref).path + ':' + (x.root ?? x.ref).line, (x.root ?? x.ref).text ?? ''])).values()].map((t) => t.replace(/[^\p{L}\p{N} :.$/]/gu, '').trim().slice(0, 30));
const titles = (r: { text: string }[]) => r.map((t) => t.text.replace(/[^\p{L}\p{N} :.$/]/gu, '').trim().slice(0, 28));

describe('one ranking', () => {
  // @req FR:task-lifecycle/rank.order @req FR:task-lifecycle/rank.overrides @req FR:task-lifecycle/rank.@function
  it("golden: with the owner's overrides the top 3 are pay bills, MVP onboarding, FH 0.10 — FOCUS is never on top", async () => {
    const r = await rankStack(ctxOf(), AT);
    const t = titles(r);
    const roots = rootsOf(r);
    expect(roots.slice(0, 3).map((x) => x.replace(/^.*?(Pay bills|Azure MVP onboarding|FH 0\.10).*$/, '$1'))).toEqual(['Pay bills', 'Azure MVP onboarding', 'FH 0.10']);
    expect(t[0]).toMatch(/Mortgage|USAA/); // the leaves of Pay bills come first (the first rule)
    expect(r.findIndex((x) => /FOCUS issues/.test(x.text))).toBeGreaterThan(2);
    expect(r.at(-1)!.project).toMatch(/FOCUS/);
  });
  // @req FR:task-lifecycle/rank.overrides
  it('without the file the engine order stands, and an unreadable file changes nothing', async () => {
    const plain = await rankStack(ctxOf(null), AT);
    const junk = await rankStack(ctxOf('{oops'), AT);
    expect(titles(junk)).toEqual(titles(plain));
    expect(plain.every((x) => x.rule === undefined)).toBe(true);
  });
  // @req FR:task-lifecycle/rank.output @req FR:task-lifecycle/$ranked-task
  it('each task names the rule that applied', async () => {
    const r = await rankStack(ctxOf(), AT);
    expect(r.find((x) => /MVP onboarding/.test(x.text))?.rule).toBe('MVP onboarding');
    expect(r.find((x) => /FOCUS issues/.test(x.text))?.rule).toBe('FOCUS');
  });
  // @req FR:task-lifecycle/rank.root
  it('a leaf names its top-level row; a top-level row has none', async () => {
    const r = await rankStack(ctxOf(), AT);
    expect(r.find((x) => /Mortgage/.test(x.text))?.root?.text).toMatch(/Pay bills/);
    expect(r.find((x) => /FH 0\.10/.test(x.text))?.root).toBeUndefined();
  });
  // @req FR:task-lifecycle/rank.limit
  it('limit caps the list', async () => { expect(await rankStack(ctxOf(), AT, 2)).toHaveLength(2); });
  // @req FR:task-lifecycle/next.rank
  it('nextTask is the first ranked task, so /next, the CLI and the web cannot disagree', async () => {
    const c = ctxOf();
    expect((await nextTask(c, AT))?.text).toBe((await rankStack(c, AT))[0].text);
  });
});
