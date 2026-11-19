/** Guards docs/cli.md: every task ref example parses, so a copied example works. */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseRef } from '../../src/cli/args';

const doc = readFileSync(resolve(__dirname, '../../docs/cli.md'), 'utf8');

describe('docs/cli.md task refs', () => {
  // @req FR:cli/ref.docs @req FR:cli/ref.format
  it('states the tasks/<file>.md:<line> format with an example that parses', () => {
    const intro = /Refs are `([^`]+)` \(1-based\), for example `([^`]+)`/.exec(doc);
    expect(intro?.[1]).toBe('tasks/<file>.md:<line>');
    expect(parseRef(intro![2])).toEqual({ path: 'tasks/alpha.md', line: 11 });
  });

  // @req FR:cli/ref.docs
  it('has only task ref examples that parseRef accepts', () => {
    const refs = [...doc.matchAll(/\btasks\/[\w./-]+\.md:\d+\b/g)].map((m) => m[0]);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(() => parseRef(r)).not.toThrow();
  });

  // @req FR:cli/ref.docs
  it('never shows a bare project:line example as a CLI task ref', () => {
    expect(doc).not.toMatch(/for example `[a-z][\w-]*:\d+`/);
  });
});
