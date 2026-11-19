/**
 * Import rule between modules (`.xe/architecture.md`, "Module layers"). A new arrow fails here: fix the import, or add the arrow to ALLOWED on purpose.
 * Arrows under `debt` are known wrong directions. Remove each one when its import is gone; never add to `debt`.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, resolve, sep } from 'path';

const root = resolve(__dirname, '../..');

/** Module of a file: `src/<name>`, or the package (`web`, `desktop`, `host`). Files outside a module (`src/index.ts`) have none. */
function moduleOf(file: string): string | null {
  const p = relative(root, file).split(sep);
  // An import of a module folder (`'../bots'`) has no file part; `src/index.ts` is the package entry, not a module.
  if (p[0] === 'src') return p[1] && !/^index(\.ts)?$/.test(p[1]) ? p[1] : null;
  if (p[0] === 'web' || p[0] === 'desktop' || p[0] === 'host') return p[0];
  return null;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'out') continue;
    const f = join(dir, name);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(f);
  }
  return out;
}

/** Relative import and re-export targets, static and dynamic. Type-only imports count: they couple modules too. */
function importsOf(text: string): string[] {
  const out: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1]);
  return out;
}

/** Each arrow in the code (`from -> to`), with the first file that has it. */
function arrows(): Map<string, string> {
  const found = new Map<string, string>();
  const files = [...walk(join(root, 'src')), ...walk(join(root, 'web/src')), ...walk(join(root, 'desktop/src')), join(root, 'host/main.ts')];
  for (const file of files) {
    const from = moduleOf(file);
    if (!from) continue;
    for (const spec of importsOf(readFileSync(file, 'utf8'))) {
      const to = moduleOf(resolve(dirname(file), spec));
      const key = `${from} -> ${to}`;
      if (to && to !== from && !found.has(key)) found.set(key, relative(root, file));
    }
  }
  return found;
}

/** Every arrow the code may have. `core` imports no other module, and `web` talks HTTP only, so neither has a line. */
const ALLOWED: Record<string, { ok: string[]; debt?: string[] }> = {
  email: { ok: ['core'] },
  graph: { ok: ['core'], debt: ['email'] },
  calendar: { ok: ['graph'], debt: ['email'] },
  inbox: { ok: ['core', 'email', 'graph'] },
  agents: { ok: ['core'], debt: ['api', 'email'] },
  api: { ok: ['core', 'agents', 'calendar', 'email', 'graph', 'inbox'] },
  mcp: { ok: ['core', 'api'] },
  cli: { ok: ['core', 'api', 'agents', 'calendar', 'email', 'graph', 'inbox'] },
  host: { ok: ['core', 'api', 'bots', 'calendar', 'inbox', 'mcp'] },
  desktop: { ok: ['core'], debt: ['cli'] },
};

describe('module boundaries', () => {
  const found = arrows();

  it('core imports no other module', () => {
    expect([...found.keys()].filter((e) => e.startsWith('core -> '))).toEqual([]);
  });

  it('web imports nothing from src, desktop or host', () => {
    expect([...found.keys()].filter((e) => e.startsWith('web -> '))).toEqual([]);
  });

  it('every arrow between modules is on the allowed list', () => {
    const bad = [...found].filter(([e]) => {
      const [from, to] = e.split(' -> ');
      const a = ALLOWED[from];
      return !a || !(a.ok.includes(to) || a.debt?.includes(to));
    }).map(([e, file]) => `${e} (${file})`);
    expect(bad).toEqual([]);
  });

  it('the allowed list has no arrow the code no longer uses', () => {
    const stale = Object.entries(ALLOWED).flatMap(([from, a]) => [...a.ok, ...(a.debt ?? [])].filter((to) => !found.has(`${from} -> ${to}`)).map((to) => `${from} -> ${to}`));
    expect(stale).toEqual([]);
  });

  it('reads imports, re-exports and dynamic imports', () => {
    const text = "import a from '../core/x';\nexport { b } from \"../api/y\";\nconst c = await import('../graph/z');\nimport type { D } from './d';\nimport '../email/e';\nimport fs from 'fs';";
    expect(importsOf(text)).toEqual(['../core/x', '../api/y', '../graph/z', './d', '../email/e']);
  });

  it('names the module of a file', () => {
    expect(moduleOf(join(root, 'src/api/auth/tokens.ts'))).toBe('api');
    expect(moduleOf(join(root, 'desktop/src/host.ts'))).toBe('desktop');
    expect(moduleOf(join(root, 'src/bots'))).toBe('bots');
    expect(moduleOf(join(root, 'src/index.ts'))).toBeNull();
  });
});
