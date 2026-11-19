/**
 * The reuse guard (used by `web/tests/ui-reuse.test.ts` only; no view imports it): finds view markup that a shared component in `web/src/ui/` owns.
 * A component names what it owns in its file: `@owns class:ui-chip` or `@owns role:tablist legacy: PrsPanel.tsx=1`.
 * @req FR:ui-kit/guard.fail
 */
export interface Owned { kind: 'class' | 'role'; name: string; /** The component file that owns it. */ owner: string; /** View file to the count it may keep. */ legacy: Record<string, number> }
export interface Finding { file: string; markup: string; count: number; allowed: number; owner: string }

/** The `@owns` tags in one component file. @req FR:ui-kit/guard.owns */
export function ownsOf(owner: string, source: string): Owned[] {
  return [...source.matchAll(/@owns[ \t]+(class|role):([\w-]+)(?:[ \t]+legacy:([^\n]*))?/g)].map((m) => ({
    kind: m[1] as Owned['kind'], name: m[2], owner,
    legacy: Object.fromEntries([...(m[3] ?? '').matchAll(/([\w./-]+\.tsx)=(\d+)/g)].map((x) => [x[1], Number(x[2])])),
  }));
}

const noComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CLASS = /\sclass=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g;

/** How many times a view's markup writes the owned class or role. Comments and selector strings do not count. */
export function usesOf(o: Pick<Owned, 'kind' | 'name'>, source: string): number {
  const text = noComments(source);
  if (o.kind === 'role') return [...text.matchAll(/\srole="([\w-]+)"/g)].filter((m) => m[1] === o.name).length;
  return [...text.matchAll(CLASS)].filter((m) => (m[1] ?? m[2] ?? m[3]).split(/[^\w-]+/).includes(o.name)).length;
}

/**
 * Each view that writes owned markup more times than its `legacy:` entry allows.
 * @req FR:ui-kit/guard.fail.legacy
 */
export function findOneOffs(owned: Owned[], views: Record<string, string>): Finding[] {
  const out: Finding[] = [];
  for (const o of owned) for (const [file, source] of Object.entries(views)) {
    const count = usesOf(o, source), allowed = o.legacy[file] ?? 0;
    if (count > allowed) out.push({ file, markup: `${o.kind}="${o.name}"`, count, allowed, owner: o.owner });
  }
  return out;
}

/**
 * One line for a finding: the file, the markup, and the component to use.
 * @req FR:ui-kit/guard.fail.message
 */
export const say = (f: Finding) => `${f.file}: ${f.count} × ${f.markup} (allowed ${f.allowed}). Use web/src/ui/${f.owner}; do not build it in the view.`;
