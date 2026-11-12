/**
 * Fetch Microsoft Fluent Emoji (`Color` SVGs) from one pinned commit into web/src/emoji/ and rewrite index.json.
 * Usage: pnpm emoji:fetch [emoji…]
 * With no arguments it rebuilds the default set; arguments add to it. The assets are committed; the page never fetches them from GitHub.
 * @req FR:agent-team/web.avatar.fetch
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';

const REPO = 'microsoft/fluentui-emoji';
/** Pinned: bump on purpose, then re-run and review the diff. */
const COMMIT = '1ffb34c752ecf5d402f04cfb4b392c77f57c54bc';
const OUT = new URL('../web/src/emoji/', import.meta.url);

/** In use: agent emoji (tasks/*.md `Agents`, agent `icon`) and project headings. */
const USED = ['👔', '🔄', '🧰', '🎧', '👓', '🍺', '⚗️', '🟣', '💰', '👨‍👩‍👧‍👦', '🏠', '🏦', '📚', '🧬', '🏃'];
/** Common picks for new agents and projects: the lightest useful ones, so the bundle stays under 400 KB (Color SVGs run 4-40 KB each). */
const COMMON = ['🤖', '🚀', '💡', '📝', '💼', '🌐', '🌱', '🔥', '📦', '🛡️', '🔒', '🔍', '📣', '🧹', '🔔', '🎵', '🧪', '🧾', '✅', '⭐', '💬', '⚡'];

/** Code points in hex joined by `-`, variation selectors dropped (matches web/src/fluent.ts). */
export const emojiKey = (e: string): string => [...e].map((c) => c.codePointAt(0)!).filter((c) => c !== 0xfe0f && c !== 0xfe0e).map((c) => c.toString(16)).join('-');

const raw = (path: string) => `https://raw.githubusercontent.com/${REPO}/${COMMIT}/${path.split('/').map(encodeURIComponent).join('/')}`;
async function get(url: string, as: 'json' | 'text'): Promise<unknown> {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: { 'user-agent': 'stack-fetch-fluent-emoji' } });
    if (res.ok) return as === 'json' ? res.json() : res.text();
    if (i >= 2 || res.status === 404) throw new Error(`${res.status} ${url}`);
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
}
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }));
  return out;
}
/** A decimal shortened: 0.1 unit at or above 1 (the art is 32 units and shows at 16-40 px, so 0.1 unit is under 0.2 px), else 3 significant digits. */
const short = (n: string): string => {
  const v = Number(n);
  const r = Math.abs(v) >= 1 ? Math.round(v * 10) / 10 : Number(v.toPrecision(3));
  return String(r).replace(/^(-?)0\./, '$1.');
};
/** Shorter numbers, then whitespace and comments; the drawing is unchanged at avatar size. Rejects anything that can run or reach out. */
export function minify(svg: string): string {
  const s = svg.replace(/<\?xml[^>]*>/g, '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/-?\d*\.\d+(?:e-?\d+)?/gi, short)
    .replace(/ (?=-)/g, '')
    .replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();
  if (/<script|\son\w+\s*=|href\s*=\s*"(?!#)/i.test(s)) throw new Error('Unsafe SVG content');
  return s;
}

async function main(): Promise<void> {
  let want = [...new Set([...USED, ...COMMON, ...process.argv.slice(2)].map(emojiKey))];
  const tree = (await get(`https://api.github.com/repos/${REPO}/git/trees/${COMMIT}?recursive=1`, 'json')) as { truncated: boolean; tree: { path: string }[] };
  if (tree.truncated) throw new Error('Tree listing truncated');
  const paths = tree.tree.map((t) => t.path);
  const metas = paths.filter((p) => /^assets\/[^/]+\/metadata\.json$/.test(p));
  const byKey = new Map<string, string>(); // key -> asset folder
  await pool(metas, 24, async (p) => {
    const m = (await get(raw(p), 'json')) as { glyph?: string; unicode?: string };
    const key = m.glyph ? emojiKey(m.glyph) : (m.unicode ?? '').split(' ').filter((c) => c !== 'fe0f').join('-');
    if (key) byKey.set(key, p.slice(0, -'/metadata.json'.length));
  });
  const missing = want.filter((k) => !byKey.has(k));
  // Fluent has no art for some sequences (family ZWJ): those stay native text on the page.
  if (missing.length) console.warn(`Not in Fluent Emoji (stays native): ${missing.map((k) => String.fromCodePoint(...k.split('-').map((h) => parseInt(h, 16)))).join(' ')}`);
  want = want.filter((k) => byKey.has(k));
  await mkdir(OUT, { recursive: true });
  for (const f of await readdir(OUT)) if (f.endsWith('.svg')) await rm(new URL(f, OUT));
  const index: Record<string, string> = {};
  let bytes = 0;
  for (const key of want.sort()) {
    const dir = byKey.get(key)!;
    const svg = paths.find((p) => p.startsWith(`${dir}/Color/`) && p.endsWith('.svg')) ?? paths.find((p) => p.startsWith(`${dir}/Default/Color/`) && p.endsWith('.svg'));
    if (!svg) throw new Error(`No Color SVG in ${dir}`);
    const body = minify((await get(raw(svg), 'text')) as string);
    await writeFile(new URL(`${key}.svg`, OUT), body);
    index[key] = svg.slice(svg.lastIndexOf('/') + 1).replace(/_color(?:_default)?\.svg$/, '');
    bytes += Buffer.byteLength(body);
  }
  await writeFile(new URL('index.json', OUT), `${JSON.stringify({ source: `https://github.com/${REPO}`, license: 'MIT', commit: COMMIT, emoji: index }, null, 2)}\n`);
  console.log(`${want.length} emoji, ${(bytes / 1024).toFixed(1)} KB`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
