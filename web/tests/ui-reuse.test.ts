import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findOneOffs, ownsOf, say, usesOf } from '../src/ui/guard';

const SRC = new URL('../src/', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, SRC), 'utf8');
const all = (readdirSync(SRC, { recursive: true }) as string[]).map((f) => f.replace(/\\/g, '/')).filter((f) => f.endsWith('.tsx'));
const kit = all.filter((f) => f.startsWith('ui/'));
const views = Object.fromEntries(all.filter((f) => !f.startsWith('ui/')).map((f) => [f, read(f)]));
const owned = kit.flatMap((f) => ownsOf(f.slice(3), read(f)));

describe('reuse guard', () => {
  // @req FR:ui-kit/guard.owns
  it.each(kit)('%s names what it owns', (f) => {
    expect(ownsOf(f, read(f)).length, `${f}: add an @owns tag (class:… or role:…)`).toBeGreaterThan(0);
  });

  // @req FR:ui-kit/guard.fail
  it('no view builds markup that a shared component owns', () => {
    expect(findOneOffs(owned, views).map(say)).toEqual([]);
  });

  // @req FR:ui-kit/guard.fail
  it('counts markup only: classes in strings and templates, roles on elements; not comments or selectors', () => {
    const src = `// <b class="ui-chip">\n/* role="tablist" */\nq('[role="tablist"] .ui-chip');\n<i class="ui-chip t-ok" /><i class={\`x ui-chip\${on ? ' on' : ''}\`} /><i class={'ui-chip'} /><i class="ui-chips" /><div role="tablist" />`;
    expect(usesOf({ kind: 'class', name: 'ui-chip' }, src)).toBe(3);
    expect(usesOf({ kind: 'role', name: 'tablist' }, src)).toBe(1);
    expect(usesOf({ kind: 'role', name: 'tab' }, src)).toBe(0);
  });

  // @req FR:ui-kit/guard.fail.legacy
  it('a view keeps the count its legacy entry names, and no more', () => {
    const own = ownsOf('Tabs.tsx', '/** @owns role:tablist legacy: A.tsx=1 b/C.tsx=2\n * @owns class:ui-tab */');
    expect(own).toEqual([{ kind: 'role', name: 'tablist', owner: 'Tabs.tsx', legacy: { 'A.tsx': 1, 'b/C.tsx': 2 } }, { kind: 'class', name: 'ui-tab', owner: 'Tabs.tsx', legacy: {} }]);
    const one = '<div role="tablist" />';
    expect(findOneOffs(own, { 'A.tsx': one, 'b/C.tsx': one })).toEqual([]);
    expect(findOneOffs(own, { 'A.tsx': one + one })).toEqual([{ file: 'A.tsx', markup: 'role="tablist"', count: 2, allowed: 1, owner: 'Tabs.tsx' }]);
    expect(findOneOffs(own, { 'New.tsx': '<b class="ui-tab" />' })).toHaveLength(1);
  });

  // @req FR:ui-kit/guard.fail.message
  it('a finding names the file, the markup, and the component', () => {
    expect(say({ file: 'New.tsx', markup: 'role="tablist"', count: 1, allowed: 0, owner: 'Tabs.tsx' })).toBe('New.tsx: 1 × role="tablist" (allowed 0). Use web/src/ui/Tabs.tsx; do not build it in the view.');
  });
});

describe('component catalog', () => {
  const doc = readFileSync(new URL('../../docs/ui-components.md', import.meta.url), 'utf8');
  const ROW = /^\| \x60(\w+)\x60 \| \x60([\w./]+)\x60 \| ([^|]*)\|/gm; // \x60 is a backtick
  const rows = [...doc.matchAll(ROW)];
  // @req FR:ui-kit/catalog
  it('says what each listed component is for', () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const [, name, , use] of rows) expect(use.trim().length, name).toBeGreaterThan(10);
  });
  // @req FR:ui-kit/catalog.current
  it('names only components that exist', () => {
    for (const [, name, file] of rows) expect(read(file.replace('web/src/', '')), `${name} in ${file}`).toMatch(new RegExp(`export function ${name}\\b`));
  });
});
