/**
 * Task quality gate: four deterministic checks per row, read from the raw markdown under the row.
 * Rows use the shapes of the live task files (verb-first leaves, PR links, mixed 🙋/🤖 rows, field bullets).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseProject } from '../../src/core/parser';
import { checkTask, checkTitle, readFields, rowRefs } from '../../src/core/quality';
import { isVerb, VERBS } from '../../src/core/verbs';

const FILE = `# 🟣 Allyte

- **Repository:** https://github.com/allytehq/finops-hubs
- **Ref prefixes:** FH = microsoft/finops-toolkit

## 🔄 Active

- [ ] 🙋 Answer the acks in flanakin/f4-music#97 📅 Nov 14: 🟢
  - Next: Reply to the 3 open threads in flanakin/f4-music#97
  - Done when: Each thread has a reply and the PR has no open threads
  - Context: The acks decide the cut of Shchedryk and two remakes.
  - Owner: me
- [ ] 🙋 🤖 Review and send the launch post 🟢
- [ ] 🙋 Launch prep
  - [ ] 🤖 Collect the launch metrics
- [ ] 🚨 🪄 📅 Nov 12: FinOpsHubs.com launch schedule draft 💰💰💰💰
- [ ] 🙋 Merge [888](https://github.com/allytehq/finops-hubs/pull/888) after CI
- [ ] 🙋 Fix FH 1234 docs
  - Links: #55, allytehq/finops-hubs#55
- [ ] 🙋 Ship the logo
  - Roland wants it blue
- [ ] 🙋 Decide the venue
  - **Next:** Pick one of the two venues
    - Venue A is closer
  - **Done when:** Venue booked
  - Context:
    - The talk is on Dec 3
- [ ] 🙋 Plan the trip; book the hotel
  - Done when: Hotel booked
  - Context: x
`;
const p = parseProject(FILE);
const at = (text: string) => p.lines.findIndex((l) => l.includes(text));
const q = (text: string) => checkTask(p, at(text))!;

describe('verbs', () => {
  // @req FR:product-reset/quality.rules
  it('lists lowercase imperative verbs and matches any case', () => {
    expect(VERBS.length).toBeGreaterThan(100);
    for (const v of VERBS) expect(v).toBe(v.toLowerCase());
    expect(isVerb('Answer')).toBe(true);
    expect(isVerb('launch')).toBe(true);
    expect(isVerb('FinOpsHubs.com')).toBe(false);
    expect(isVerb('the')).toBe(false);
  });
});

describe('checkTitle', () => {
  // @req FR:product-reset/quality.rules
  it('drops owner marks, the due mark and leading emoji', () => {
    expect(checkTitle('🚨 🪄 📅 Nov 12: FinOpsHubs.com launch schedule draft 💰💰💰💰')).toBe('FinOpsHubs.com launch schedule draft 💰💰💰💰');
    expect(checkTitle('🤖:assist Send the CIO Review decline 🟢')).toBe('Send the CIO Review decline 🟢');
    expect(checkTitle('🙋 Answer the acks')).toBe('Answer the acks');
  });
});

describe('readFields', () => {
  // @req FR:product-reset/schema.grammar @req FR:product-reset/schema.keys
  it('reads plain and bold fields; lines nested under a field are part of it; other lines are notes', () => {
    const r = readFields(p, p.sections[0].tasks.find((t) => t.text.includes('Decide the venue'))!);
    expect(r.fields.next).toBe('Pick one of the two venues');
    expect(r.fields.doneWhen).toBe('Venue booked');
    expect(r.fields.context).toEqual(['The talk is on Dec 3']);
    expect(r.notes).toEqual([]);
    const logo = readFields(p, p.sections[0].tasks.find((t) => t.text.includes('Ship the logo'))!);
    expect(logo.notes).toEqual(['Roland wants it blue']);
    expect(logo.fields).toEqual({ context: [], links: [] });
  });

  // @req FR:product-reset/schema.grammar
  it('skips child task rows and their lines; the first single-value field wins', () => {
    const src = '# X\n\n## A\n\n- [ ] Ship it\n  - [ ] Child\n    - Next: not mine\n  - Next: first\n  - Next: second\n';
    const pp = parseProject(src);
    const r = readFields(pp, pp.sections[0].tasks[0]);
    expect(r.fields.next).toBe('first');
    expect(r.notes).toEqual([]);
  });
});

describe('readFields nested single-value fields', () => {
  // @req FR:product-reset/schema.grammar
  it('a single-value field with only nested lines takes them; the first field still wins', () => {
    const src = '# X\n\n## A\n\n- [ ] Plan it\n  - Done when:\n    - Venue booked\n    - Date set\n  - Done when: later\n  - Next:\n    - Call the venue\n';
    const pp = parseProject(src);
    const r = readFields(pp, pp.sections[0].tasks[0]);
    expect(r.fields.doneWhen).toBe('Venue booked; Date set');
    expect(r.fields.next).toBe('Call the venue');
  });
});

describe('rowRefs', () => {
  // @req FR:product-reset/schema.refs
  it('resolves full refs, URLs, short refs from Repository, and prefixes; unresolved refs are text', () => {
    const meta = p.metadata;
    expect(rowRefs('see flanakin/f4-music#97 and https://github.com/allytehq/finops-hubs/pull/888', meta)).toEqual(['flanakin/f4-music#97', 'allytehq/finops-hubs#888']);
    expect(rowRefs('#55 and finops-hubs#55 and PR 55', meta)).toEqual(['allytehq/finops-hubs#55']);
    expect(rowRefs('FH 1234', meta)).toEqual(['microsoft/finops-toolkit#1234']);
    expect(rowRefs('#55', {})).toEqual([]);
    expect(rowRefs('[a](https://github.com/o/r/pull/1),[b](https://github.com/o/r/pull/2)', {})).toEqual(['o/r#1', 'o/r#2']);
    expect(rowRefs('https://github.com/o/r/pull/1/files#x, https://github.com/o/r/issues/2', {})).toEqual(['o/r#1', 'o/r#2']);
    expect(rowRefs('#5', meta, 'o/r')).toEqual(['o/r#5']);
    expect(rowRefs('call at 5', meta)).toEqual([]);
  });
});

describe('checkTask ancestors', () => {
  // @req FR:product-reset/schema.refs
  it('a short ref resolves against the nearest ancestor link before project metadata', () => {
    const src = '# X\n\n## A\n\n- [ ] 🤖 Land the fix\n  - Links: o/r#4\n  - [ ] 🤖 Merge #5\n';
    const pp = parseProject(src);
    const line = pp.lines.findIndex((l) => l.includes('Merge #5'));
    expect(checkTask(pp, line)!.missing).not.toContain('doneWhen');
    expect(checkTask(pp, line)!.missing).not.toContain('context');
    const none = parseProject(src.replace('  - Links: o/r#4\n', ''));
    expect(checkTask(none, none.lines.findIndex((l) => l.includes('Merge #5')))!.missing).toEqual(expect.arrayContaining(['doneWhen', 'context']));
  });
});

describe('checkTask', () => {
  // @req FR:product-reset/quality.check @req FR:product-reset/quality.rules @req FR:product-reset/quality.score
  it('scores 4 for a row with every field', () => {
    expect(q('Answer the acks')).toEqual({ score: 4, actionable: true, missing: [] });
  });

  // @req FR:product-reset/quality.rules @req FR:product-reset/schema.owner
  it('a mixed row that joins two verbs fails single; no fields fails doneWhen and context', () => {
    expect(q('Review and send')).toEqual({ score: 1, actionable: false, missing: ['doneWhen', 'context', 'single'] });
  });

  // @req FR:product-reset/quality.rules
  it('a parent row needs a Next field even with a verb title', () => {
    expect(q('Launch prep').missing).toContain('next');
  });

  // @req FR:product-reset/quality.rules
  it('a topic title fails next', () => {
    expect(q('FinOpsHubs.com launch').missing).toEqual(['next', 'doneWhen', 'context']);
  });

  // @req FR:product-reset/quality.rules
  it('one linked PR passes doneWhen and context', () => {
    expect(q('Merge [888]')).toEqual({ score: 4, actionable: true, missing: [] });
  });

  // @req FR:product-reset/quality.rules @req FR:product-reset/schema.refs
  it('two distinct refs fail doneWhen; the same ref twice counts once', () => {
    expect(q('Fix FH 1234').missing).toEqual(['doneWhen']);
    const src = '# X\n\n- **Repository:** https://github.com/o/r\n\n## A\n\n- [ ] Fix the bug\n  - Links: #5, o/r#5\n';
    const pp = parseProject(src);
    expect(checkTask(pp, pp.lines.findIndex((l) => l.includes('Fix the bug')))).toEqual({ score: 4, actionable: true, missing: [] });
  });

  // @req FR:product-reset/quality.rules
  it('a title that is a markdown link reads as its label; the link still counts as a ref', () => {
    const src = '# X\n\n## A\n\n- [ ] [Review the spec](https://github.com/o/r/pull/5)\n';
    const pp = parseProject(src);
    expect(checkTitle(pp.sections[0].tasks[0].text)).toBe('Review the spec');
    expect(checkTask(pp, 4)).toEqual({ score: 4, actionable: true, missing: [] });
  });

  // @req FR:product-reset/quality.rules
  it('a note passes context', () => {
    expect(q('Ship the logo').missing).toEqual(['doneWhen']);
  });

  // @req FR:product-reset/quality.rules
  it('a semicolon joining two verbs fails single', () => {
    expect(q('Plan the trip').missing).toEqual(['single']);
  });

  // @req FR:product-reset/quality.rules @req FR:product-reset/schema.owner
  it('an Owner field settles a mixed row', () => {
    const src = '# X\n\n## A\n\n- [ ] 🙋 🤖 Send the post\n  - Owner: me\n  - Done when: Sent\n  - Context: x\n';
    const pp = parseProject(src);
    expect(checkTask(pp, 4)).toEqual({ score: 4, actionable: true, missing: [] });
  });

  // @req FR:product-reset/quality.check
  it('returns null for a line that is not a task row', () => {
    expect(checkTask(p, 0)).toBeNull();
    expect(checkTask(p, 9999)).toBeNull();
  });
});

describe('docs/task-rubric.md', () => {
  // @req FR:product-reset/quality.rubric
  it('holds the rubric from the spec, and the agent instructions link to it', () => {
    const read = (f: string) => readFileSync(join(__dirname, '../..', f), 'utf8');
    const block = (s: string) => /```text\n(\s*Task rubric[\s\S]*?)```/.exec(s)![1].split('\n').map((l) => l.trim()).filter(Boolean);
    expect(block(read('docs/task-rubric.md'))).toEqual(block(read('.xe/features/product-reset/spec.md')));
    expect(read('docs/agent-instructions.md')).toContain('(task-rubric.md)');
  });
});
