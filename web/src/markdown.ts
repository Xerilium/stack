/** Tiny markdown subset as a node tree (no HTML strings reach the DOM). @req FR:web-app/edit.preview */
export type Node = string | { t: 'b' | 'i'; c: Node[] } | { t: 'code'; c: string } | { t: 'a'; href: string; c: string };

const RE = /`([^`]+)`|\*\*([^*]+?)\*\*|\*(?!\s)([^*]+?)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function parseInline(src: string): Node[] {
  const out: Node[] = [];
  let last = 0;
  for (const m of src.matchAll(RE)) {
    if (m.index! > last) out.push(src.slice(last, m.index));
    if (m[1] !== undefined) out.push({ t: 'code', c: m[1] });
    else if (m[2] !== undefined) out.push({ t: 'b', c: parseInline(m[2]) });
    else if (m[3] !== undefined) out.push({ t: 'i', c: parseInline(m[3]) });
    else out.push({ t: 'a', href: m[5], c: m[4] });
    last = m.index! + m[0].length;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Serialize nodes (used by tests and for plain-text fallbacks). */
export function toHtml(src: string): string {
  const go = (ns: Node[]): string => ns.map((n) => {
    if (typeof n === 'string') return esc(n);
    if (n.t === 'code') return `<code>${esc(n.c)}</code>`;
    if (n.t === 'a') return `<a href="${esc(n.href)}" rel="noopener noreferrer" target="_blank">${esc(n.c)}</a>`;
    return `<${n.t}>${go(n.c)}</${n.t}>`;
  }).join('');
  return go(parseInline(src));
}
