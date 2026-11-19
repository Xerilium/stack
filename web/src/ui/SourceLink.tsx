/**
 * A link to where an item came from, named by its kind: a pull request, an issue, a session, an email, or a site.
 * @req FR:ui-kit/source
 */
import './ui.css';

export type SourceKind = 'pr' | 'issue' | 'session' | 'email' | 'site';
export interface Source { kind: SourceKind; /** The words on the link, for example `PR stack#158`. */ label: string }

/** Mail web apps only: a suite's other sites (office.com, onedrive.live.com) are not mail. */
const MAIL = /^(outlook\.(office|office365|live)\.com|mail\.google\.com|mail\.proton\.me|app\.fastmail\.com)$/;

/** Name a link by its source. Returns null for text that is not a link. Pure. */
export function sourceOf(href: string | undefined): Source | null {
  let u: URL;
  try { u = new URL(href ?? ''); } catch { return null; }
  if (u.protocol === 'mailto:') return { kind: 'email', label: 'Email' };
  if (u.protocol === 'claude:' || (/(^|\.)claude\.ai$/.test(u.hostname) && /\/(code|epitaxy)\//.test(u.pathname))) return { kind: 'session', label: 'Session' };
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const gh = u.hostname === 'github.com' ? /^\/[^/]+\/([^/]+)\/(pull|issues)\/(\d+)/.exec(u.pathname) : null;
  if (gh) return gh[2] === 'pull' ? { kind: 'pr', label: `PR ${gh[1]}#${gh[3]}` } : { kind: 'issue', label: `Issue ${gh[1]}#${gh[3]}` };
  if (MAIL.test(u.hostname)) return { kind: 'email', label: 'Email' };
  return { kind: 'site', label: u.hostname.replace(/^www\./, '') };
}

/** The link, in a new tab. Draws nothing when `href` is not a link. A click never reaches the row under it. */
export function SourceLink({ href }: { href: string | undefined }) {
  const s = sourceOf(href);
  if (!s) return null;
  return <a class="ui-source" data-kind={s.kind} href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{s.label}<span aria-hidden="true"> ↗</span></a>;
}
