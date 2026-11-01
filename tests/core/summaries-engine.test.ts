import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseConfig } from '../../src/core/config';
import { rankStack } from '../../src/core/lifecycle';
import { FsStorage } from '../../src/core/storage';
import { formatNumber, generateSummaries, type SummaryInput } from '../../src/core/summaries';

const FIX = join(__dirname, '../fixtures/rank-2026-11-01');
const projects = readdirSync(join(FIX, 'tasks')).filter((f) => f.endsWith('.md')).map((fileName) => ({ fileName, content: readFileSync(join(FIX, 'tasks', fileName), 'utf8') }));
const config = parseConfig(JSON.parse(readFileSync(join(FIX, '.xe/config/stack.json'), 'utf8').replace(/^﻿/, '')));
const priorities = readFileSync(join(FIX, '.stack/priorities.json'), 'utf8');
const SUN = new Date('2026-11-01T22:00:00-07:00');
const MON = new Date('2026-11-02T10:00:00-08:00'); // the Work block: Finance has only family-time capacity
const input = (over: Partial<SummaryInput> = {}): SummaryInput => ({ projects, config, now: SUN, ...over });
const ctx = { storage: new FsStorage(FIX), config, engine: 'stack' };
const clean = (s: string) => s.replace(/^﻿/, '');
/** Leaf lines of stack.md in file order: `text 🟰 score`. */
const leaves = (stack: string) => [...clean(stack).matchAll(/^ {2}- (?:\[.\] )?(.*) 🟰 ([\d.]+)$|^ {4}- (.*) 🟰 ([\d.]+)$|^\s*- (.*) 🟰 ([\d.]+)$/gm)].map((m) => ({ text: (m[1] ?? m[3] ?? m[5]) as string, score: Number(m[2] ?? m[4] ?? m[6]) }));

describe('the shared scorer in the summaries', () => {
  // @req FR:summaries/engine.@option
  it('legacy is the default and the output is the same with or without saying so', () => {
    const a = generateSummaries(input());
    const b = generateSummaries(input({ engine: 'legacy', priorities }));
    expect(b).toEqual(a); // the overrides never touch the parity path
    expect(clean(a.stack)).not.toContain('due-date lens');
  });

  // @req FR:summaries/engine.scores @req FR:summaries/engine.order
  it('stack: the first row of stack.md is the first row of `stack next`, with the same score; FOCUS is last', async () => {
    const files = generateSummaries(input({ engine: 'stack', priorities }));
    const ranked = await rankStack(ctx as never, SUN, undefined, { ignoreBlocks: true });
    const rows = leaves(files.stack);
    expect(rows[0].text).toMatch(/Mortgage|USAA/);
    expect(rows[0].score).toBe(Number(formatNumber(ranked[0].score)));
    expect(rows.at(-1)!.text).toMatch(/Preview PR|FOCUS/);
  });

  // @req FR:summaries/engine.order
  it('stack without overrides orders by the engine score alone', async () => {
    const files = generateSummaries(input({ engine: 'stack' }));
    const rows = leaves(files.stack);
    const scores = rows.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  // @req FR:summaries/engine.order.hide
  it('a hide rule sinks the row to the end of stack.md; it does not disappear', () => {
    const hide = JSON.stringify({ rules: [{ match: 'Pay bills', effect: 'hide' }] });
    const rows = leaves(generateSummaries(input({ engine: 'stack', priorities: hide })).stack);
    expect(rows.at(-1)!.text).toMatch(/Mortgage|USAA/);
    expect(rows.some((r) => /Mortgage/.test(r.text))).toBe(true);
  });

  // @req FR:summaries/engine.top.blocks
  it('stack: a top rule keeps its row in the README top list even in the Work block; legacy does not', () => {
    const stack = clean(generateSummaries(input({ now: MON, engine: 'stack', priorities })).readme);
    const legacy = clean(generateSummaries(input({ now: MON })).readme);
    expect(stack).toMatch(/Pay bills/);
    expect(legacy).not.toMatch(/Mortgage/);
  });

  // @req FR:summaries/engine.breakdown
  it('the breakdown says why the score differs from the formula, and never cries mismatch', () => {
    const stack = clean(generateSummaries(input({ engine: 'stack', priorities })).stack);
    expect(stack).toMatch(/due-date lens/);
    expect(stack).not.toContain('does not match the evaluated score');
  });
});
