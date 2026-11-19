/**
 * Task bloat lint: rules on one title, one file, and one row. The fixture rows follow the shapes of real bloated task lines; the details are made up.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { formatIssue, lintProject, lintRow, lintTitle, MAX_TITLE } from '../../src/core/task-lint';

const SRC = readFileSync(resolve(__dirname, '../fixtures/task-lint/bloated.md'), 'utf8');
const rules = (text: string) => lintTitle(text).map((f) => f.rule);

describe('lintTitle', () => {
  // @req FR:task-lint/title.@function
  it('passes a short title and returns findings in rule order', () => {
    expect(lintTitle('🙋 Answer the acks 🟢')).toEqual([]);
    expect(rules(`${'Fix the export '.repeat(9)}(a) (b) -- blocked`)).toEqual(['title-length', 'title-status', 'title-parens', 'detail-nesting']);
  });

  // @req FR:task-lint/rule.length
  it('fails a title of more than 120 characters and states the count', () => {
    expect(MAX_TITLE).toBe(120);
    expect(lintTitle('x'.repeat(120))).toEqual([]);
    expect(lintTitle('x'.repeat(121))).toEqual([{ rule: 'title-length', message: 'Title has 121 characters (max 120). Move detail to nested bullets.' }]);
    expect(lintTitle('🟢'.repeat(120))).toEqual([]);
  });

  // @req FR:task-lint/title.links
  it('reads a markdown link as its label', () => {
    expect(lintTitle(`Review [the long spec](https://example.com/${'a'.repeat(200)}) today`)).toEqual([]);
    expect(rules('Fix [887](https://github.com/o/r/pull/887) and [888](https://github.com/o/r/pull/888)')).toEqual([]);
    expect(rules(`Read https://example.com/blocked/x_(y)_(z)/${'a'.repeat(200)}`)).toEqual([]);
  });

  // @req FR:task-lint/title.code
  it('does not read a code span for words, but counts its length', () => {
    expect(rules('Rename `blocked (a) (b) -- x` in the schema')).toEqual([]);
    expect(rules(`Rename \`${'x'.repeat(121)}\``)).toEqual(['title-length']);
  });

  // @req FR:task-lint/rule.status @req FR:task-lint/rule.status.words
  it.each(['done', 'waiting', 'blocked', 'merged', 'landed', 'shipped', 'parked', 'on hold', 'as of'])('fails the status word %s', (w) => {
    expect(lintTitle(`Portal extension ${w} for now`)).toEqual([{ rule: 'title-status', message: `Title holds status text "${w}". Move it to a nested bullet.` }]);
    expect(rules(`Portal extension ${w.toUpperCase()}`)).toEqual(['title-status']);
  });

  // @req FR:task-lint/rule.status.words
  it('matches whole words only', () => {
    expect(rules('Fix the abandoned cart, the unblocked queue, and the emerged bug')).toEqual([]);
    expect(rules('PR #12 merged')).toEqual(['title-status']);
    expect(rules('Rename done_when and status=merged in the schema')).toEqual([]);
  });

  // @req FR:task-lint/rule.status.dates
  it('fails a date in the title', () => {
    expect(lintTitle('Publish the post Nov 18')[0].message).toBe('Title holds status text "Nov 18". Move it to a nested bullet.');
    expect(rules('Publish the post November 18')).toEqual(['title-status']);
    expect(rules('Publish the post 2026-11-18')).toEqual(['title-status']);
    expect(rules('Publish the post Nov 18th')).toEqual(['title-status']);
    expect(rules('Publish the post 18 Nov')).toEqual(['title-status']);
    expect(rules('Read the May report, the March notes, and PRs 11/18')).toEqual([]);
  });

  // @req FR:task-lint/title.exempt
  it('does not read agent tags, tier markers, date marks, or query triggers', () => {
    expect(rules('1️⃣ Approve the QM plan (4 tasks) (agent: qm-planner)')).toEqual([]);
    expect(rules('📅 Nov 14: Answer the acks 🟢')).toEqual([]);
    expect(rules('Send the form 📅 Nov 5')).toEqual([]);
    expect(rules('📅 Nov 19: 🔄 Monthly: Pay the card')).toEqual([]);
    expect(rules('⏰ Apr 1: Check the API again')).toEqual([]);
    expect(rules('Check the API again ⏰ Apr 1:')).toEqual([]);
    expect(rules('💤 Nov 5: Check the API again')).toEqual([]);
    expect(rules('💤 Nov 5 14:30: Check the API again')).toEqual([]);
    expect(rules('PR review sweep 🟡 🔎 @GitHub/o/r (is:pr state:open) (weekly)')).toEqual([]);
    expect(rules(`2️⃣ ${'x'.repeat(118)} (agent: ${'a'.repeat(40)})`)).toEqual([]);
  });

  // @req FR:task-lint/rule.parens
  it('fails more than 1 parenthetical and states the count', () => {
    expect(rules('Fix the export (CSV)')).toEqual([]);
    expect(lintTitle('Fix the export (CSV) for the hub (FH 0.11)')).toEqual([{ rule: 'title-parens', message: 'Title has 2 parentheticals (max 1). Move detail to nested bullets.' }]);
    expect(rules('Fix the export (CSV (v2))')).toEqual([]);
  });

  // @req FR:task-lint/rule.nesting.inline
  it('fails detail after a dash separator', () => {
    for (const d of ['--', '—', '–']) expect(lintTitle(`Portal extension ${d} ask the reviewer`)).toEqual([{ rule: 'detail-nesting', message: 'Title holds detail after a dash. Move it to a nested bullet.' }]);
    expect(rules('Fix the top-item query - part 2')).toEqual([]);
  });
});

describe('lintProject', () => {
  const issues = lintProject('tasks/bloat.md', SRC);
  const at = (line: number) => issues.filter((i) => i.line === line).map((i) => i.rule);

  // @req FR:task-lint/file.@function
  it('returns issues with the path and a 1-based line, in line order', () => {
    expect(issues.every((i) => i.path === 'tasks/bloat.md')).toBe(true);
    expect(issues.map((i) => i.line)).toEqual([...issues.map((i) => i.line)].sort((a, b) => a - b));
    expect([...new Set(issues.map((i) => i.line))]).toEqual([5, 6, 7, 8, 9, 10, 11, 13, 15, 21]);
    expect(formatIssue(issues[0])).toBe('tasks/bloat.md:5 title-status Title holds status text "as of". Move it to a nested bullet.');
  });

  // @req FR:task-lint/rule.status @req FR:task-lint/rule.parens @req FR:task-lint/rule.length @req FR:task-lint/rule.nesting.inline
  it('names each rule a real bloated row breaks', () => {
    expect(at(5)).toEqual(['title-status']);
    expect(at(6)).toEqual(['title-status']);
    expect(at(7)).toEqual(['title-status']);
    expect(at(8)).toEqual(['title-status', 'detail-nesting']);
    expect(at(9)).toEqual(['title-length', 'title-status', 'title-parens', 'detail-nesting']);
    expect(at(10)).toEqual(['title-status']);
    expect(at(11)).toEqual(['title-parens']);
  });

  // @req FR:task-lint/rule.nesting.prose
  it('fails a nested line that is not a bullet, at the line of the prose', () => {
    expect(issues.filter((i) => [13, 15, 21].includes(i.line))).toEqual([13, 15, 21].map((line) => ({ path: 'tasks/bloat.md', line, rule: 'detail-nesting', message: 'Detail line is not a bullet. Start it with "- ".' })));
  });

  // @req FR:task-lint/rule.nesting.allowed
  it('passes bullets, child rows, blockquotes, and code fences', () => {
    for (const line of [12, 14, 16, 17, 18, 19, 20, 27]) expect(at(line)).toEqual([]);
  });

  // @req FR:task-lint/rule.nesting.allowed @req FR:task-lint/rule.nesting.prose
  it('passes a numbered item and other bullet marks', () => {
    expect(lintProject('tasks/a.md', '# A\n\n## Active\n\n- [ ] Decide the plan\n  1. First option\n  2) Second option\n  * Star\n  + Plus\n  2026 was the year\n').map((i) => i.line)).toEqual([10]);
  });

  // @req FR:task-lint/rule.nesting.allowed
  it('skips code fences of both kinds and the task rows inside them', () => {
    const src = ['# A', '', '## Active', '', '- [ ] Write the guide', '  ```markdown', '  - [ ] Example -- blocked', '    prose', '  ```', '  ~~~', '  plain', '  ```', '  still fenced', '  ~~~', '', '\tafter a blank line', '```', '- [ ] Top example -- done', '```', ''].join('\n');
    expect(lintProject('tasks/a.md', src).map((i) => `${i.line} ${i.rule}`)).toEqual(['16 detail-nesting']);
    expect(lintRow('tasks/a.md', src, 7)).toEqual([]);
  });

  // @req FR:task-lint/scope.open
  it('skips a checked row and the prose under it', () => {
    expect(at(22)).toEqual([]);
    expect(at(23)).toEqual([]);
  });

  // @req FR:task-lint/scope.generated
  it('skips a script-owned query row', () => {
    expect(at(24)).toEqual([]);
    expect(lintProject('tasks/a.md', `# A\n\n## Active\n\n- [ ] 🌐 ${'x'.repeat(200)} — merged (a) (b)\n`)).toEqual([]);
  });

  // @req FR:task-lint/title.exempt
  it('passes clean rows with tags and marks', () => {
    for (const line of [25, 26, 28]) expect(at(line)).toEqual([]);
  });

  // @req FR:task-lint/file.@function
  it('reads CRLF files and files with a BOM', () => {
    expect(lintProject('tasks/a.md', '﻿# A\r\n\r\n## Active\r\n\r\n- [ ] Ship it -- blocked\r\n  prose\r\n').map((i) => `${i.line} ${i.rule}`)).toEqual(['5 title-status', '5 detail-nesting', '6 detail-nesting']);
  });
});

describe('lintRow', () => {
  // @req FR:task-lint/file.row
  it('returns the title issues and the prose lines of that row only', () => {
    expect(lintRow('tasks/bloat.md', SRC, 12).map((i) => i.line)).toEqual([13, 15]);
    expect(lintRow('tasks/bloat.md', SRC, 8).map((i) => i.rule)).toEqual(['title-status', 'detail-nesting']);
    expect(lintRow('tasks/bloat.md', SRC, 20).map((i) => i.line)).toEqual([21]);
    expect(lintRow('tasks/bloat.md', SRC, 26)).toEqual([]);
    expect(lintRow('tasks/bloat.md', SRC, 22)).toEqual([]);
    expect(lintRow('tasks/bloat.md', SRC, 1)).toEqual([]);
  });
});
