/** Tiny markdown subset as a node tree (no HTML strings reach the DOM): task and ask text is rendered as text, never as html. @req FR:web-app/edit.preview @req NFR:live-deploy/security.text */
export type Node = string | { t: 'b' | 'i'; c: Node[] } | { t: 'code'; c: string } | { t: 'a'; href: string; c: string };

const RE = /`([^`]+)`|\*\*([^*]+?)\*\*|\*(?!\s)([^*]+?)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

/**
 * What a short ref resolves against: the project repo (`owner/name`), every known repo, and the project `Ref prefixes`.
 * @req FR:product-reset/schema.refs
 */
export interface RefCtx { repo?: string; repos: string[]; prefixes: Record<string, string> }
const NO_REFS: RefCtx = { repos: [], prefixes: {} };

/** `owner/name` from `owner/name`, a GitHub url, or a markdown link to one; null for a bare folder name. */
export function repoSlug(raw: string): string | null {
  const s = raw.trim().replace(/^\[[^\]]*\]\(([^)]*)\)$/, '$1').replace(/^`|`$/g, '').replace(/\.git$/, '').replace(/\/+$/, '');
  const m = /^(?:https?:\/\/(?:www\.)?github\.com\/)?([\w.-]+)\/([\w.-]+)$/.exec(s);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Ref context per project from `Repository:`, `Repos:` and `Ref prefixes:` metadata (a prefix from any project works everywhere; the own project wins). @req FR:product-reset/schema.refs */
export function refCtxOf(projects: { name: string; metadata?: Record<string, string> }[]): (project?: string) => RefCtx {
  const own = new Map<string, { repo?: string; prefixes: Record<string, string> }>();
  const all: string[] = [];
  const shared: Record<string, string> = {};
  for (const p of projects) {
    const md = p.metadata ?? {};
    const list = [md['Repository'] ?? '', ...(md['Repos'] ?? '').split(',')].map(repoSlug).filter((r): r is string => !!r);
    const prefixes: Record<string, string> = {};
    for (const pair of (md['Ref prefixes'] ?? '').split(',')) {
      const m = /^\s*([A-Za-z][\w-]*)\s*=\s*(\S+)\s*$/.exec(pair);
      const slug = m && repoSlug(m[2]);
      if (m && slug) prefixes[m[1]] = slug;
    }
    for (const r of list) if (!all.includes(r)) all.push(r);
    for (const [k, v] of Object.entries(prefixes)) shared[k] ??= v;
    own.set(p.name, { repo: list[0], prefixes });
  }
  return (project) => {
    const o = project ? own.get(project) : undefined;
    return { repo: o?.repo, repos: all, prefixes: { ...shared, ...o?.prefixes } };
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const gh = (slug: string, n: string, pull = false) => `https://github.com/${slug}/${pull ? 'pull' : 'issues'}/${n}`;
const name = (slug: string) => slug.slice(slug.indexOf('/') + 1);

/** Bare urls and PR/issue refs in plain text as links; an unresolved ref stays text. @req FR:product-reset/ui.reflink @req FR:product-reset/schema.refs */
function linkRefs(src: string, ctx: RefCtx): Node[] {
  const pre = Object.keys(ctx.prefixes).map((k) => k.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('|');
  const re = new RegExp([
    // Balanced parens stay in the path (`wiki/Foo_(bar)`); trailing punctuation does not.
    /(?<url>https?:\/\/(?:[^\s<>()[\]]|\([^\s<>()[\]]*\))*(?:[^\s<>()[\].,;:!?'"]|\([^\s<>()[\]]*\)))/.source,
    /(?<![\w/.-])(?<owner>[\w.-]+)\/(?<repo>[\w.-]+)#(?<on>\d+)\b/.source,
    /\bPR ?#?(?<pr>\d+)\b/.source,
    /(?<![\w/#.-])(?<short>[A-Za-z][\w.-]*)#(?<sn>\d+)\b/.source,
    // 6+ digits is a hex color (`#333333`), not an issue.
    /(?<![\w&/#])#(?<hn>\d{1,5})\b/.source,
    pre ? `\\b(?<px>${pre}) #?(?<pn>\\d+)\\b` : '(?!)',
  ].join('|'), 'g');
  const out: Node[] = [];
  let last = 0;
  const push = (s: string) => { if (!s) return; if (typeof out[out.length - 1] === 'string') out[out.length - 1] += s; else out.push(s); };
  const known = (slug: string) => ctx.repos.find((r) => r.toLowerCase() === slug.toLowerCase());
  for (const m of src.matchAll(re)) {
    const g = m.groups!;
    let link: { href: string; c: string } | null = null;
    if (g.url) {
      const u = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/(?:pull|issues)\/(\d+)\/?$/.exec(g.url);
      link = { href: g.url, c: u ? `${u[2]}#${u[3]}` : g.url };
    } else if (g.on) {
      // A dot in the name could be a file path (`src/a.ts#12`): link only a known repo then.
      const slug = g.repo.includes('.') ? known(`${g.owner}/${g.repo}`) : `${g.owner}/${g.repo}`;
      if (slug) link = { href: gh(slug, g.on), c: `${name(slug)}#${g.on}` };
    } else if (g.pr) { if (ctx.repo) link = { href: gh(ctx.repo, g.pr, true), c: m[0] }; }
    else if (g.sn) {
      const slug = ctx.repo && name(ctx.repo).toLowerCase() === g.short.toLowerCase() ? ctx.repo : ctx.repos.find((r) => name(r).toLowerCase() === g.short.toLowerCase());
      if (slug) link = { href: gh(slug, g.sn), c: m[0] };
    } else if (g.hn) { if (ctx.repo) link = { href: gh(ctx.repo, g.hn), c: m[0] }; }
    else if (g.pn) link = { href: gh(ctx.prefixes[g.px], g.pn), c: m[0] };
    if (!link) continue;
    push(src.slice(last, m.index));
    out.push({ t: 'a', ...link });
    last = m.index! + m[0].length;
  }
  push(src.slice(last));
  return out;
}

export function parseInline(src: string, refs: RefCtx = NO_REFS): Node[] {
  const out: Node[] = [];
  let last = 0;
  for (const m of src.matchAll(RE)) {
    if (m.index! > last) out.push(...linkRefs(src.slice(last, m.index), refs));
    if (m[1] !== undefined) out.push({ t: 'code', c: m[1] });
    else if (m[2] !== undefined) out.push({ t: 'b', c: parseInline(m[2], refs) });
    else if (m[3] !== undefined) out.push({ t: 'i', c: parseInline(m[3], refs) });
    else out.push({ t: 'a', href: m[5], c: m[4] });
    last = m.index! + m[0].length;
  }
  if (last < src.length) out.push(...linkRefs(src.slice(last), refs));
  return out;
}

/** The links in a text, in order: markdown links, bare urls and resolved refs. */
export function mdLinks(text: string, refs: RefCtx = NO_REFS): { href: string; label: string }[] {
  const out: { href: string; label: string }[] = [];
  const walk = (ns: Node[]) => { for (const n of ns) { if (typeof n === 'string' || n.t === 'code') continue; if (n.t === 'a') out.push({ href: n.href, label: n.c }); else walk(n.c); } };
  walk(parseInline(text, refs));
  return out;
}

/** Serialize nodes (used by tests and for plain-text fallbacks). */
export function toHtml(src: string, refs: RefCtx = NO_REFS): string {
  const go = (ns: Node[]): string => ns.map((n) => {
    if (typeof n === 'string') return esc(n);
    if (n.t === 'code') return `<code>${esc(n.c)}</code>`;
    if (n.t === 'a') return `<a href="${esc(n.href)}" rel="noopener noreferrer" target="_blank">${esc(n.c)}</a>`;
    return `<${n.t}>${go(n.c)}</${n.t}>`;
  }).join('');
  return go(parseInline(src, refs));
}
