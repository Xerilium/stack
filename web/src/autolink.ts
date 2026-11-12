/**
 * References in text as GitHub links: full urls, `owner/repo#123`, `#123`, `PR 123`, and `<alias> 123` (like `FH 1105`).
 * The repo for a bare number comes from the context (the ask's link or project); an alias comes from the project map
 * (each project's name, title and aliases to its `Repository`). A reference with no repo stays plain text. Pure.
 * @req FR:ask-briefs/link.refs @req FR:ask-briefs/link.repo
 */
export type Seg = string | { href: string; text: string };
/** Lower-case project name, title or alias to `owner/repo`. */
export type RepoMap = Record<string, string>;
export interface LinkCtx { repo?: string; repos?: RepoMap }

const REPO = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/;
const GH = /^https:\/\/github\.com\/([A-Za-z0-9][\w.-]*)\/([\w.-]+?)(?:\.git)?(?:[/?#]|$)/;
/** First path segments that are GitHub pages, not owners. */
const NOT_OWNER = new Set(['orgs', 'users', 'settings', 'apps', 'marketplace', 'sponsors', 'features', 'topics', 'notifications', 'search', 'login', 'enterprises']);
// 1 url · 2-3 owner/repo#n · 4-5 word n (alias or PR) · 6 PR#n · 7 bare #n
const RE = /(https:\/\/[^\s<>"'`]+)|\b([A-Za-z0-9][\w.-]*\/[\w.-]+)#(\d{1,7})\b|\b([A-Za-z][\w-]{0,23})\s+(?:PR\s+)?#?(\d{1,7})\b|\bPR#(\d{1,7})\b|(?<![\w/&#])#(\d{1,7})\b/gi;

/** `owner/repo` of a GitHub url, else undefined. */
export function repoOfUrl(url: string | undefined): string | undefined {
  const m = url ? GH.exec(url) : null;
  return m && !NOT_OWNER.has(m[1].toLowerCase()) ? `${m[1]}/${m[2]}` : undefined;
}

/** `owner/repo` from a `Repository` value: a markdown link, a url, or `owner/repo`. */
function repoOfValue(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const t = v.trim();
  const md = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t);
  if (md) return repoOfUrl(md[2]) ?? (REPO.test(md[1]) ? md[1] : undefined);
  return repoOfUrl(t) ?? (REPO.test(t) ? t : undefined);
}

/** The project map: name and each alias (lower case) to the project's `Repository` (or `Repo`). Titles are prose ("Stack 2.0"), so never keys. */
export function repoMapOf(projects: { name: string; title?: string; metadata?: Record<string, string> }[]): RepoMap {
  const out: RepoMap = {};
  for (const p of projects) {
    const m = p.metadata ?? {};
    const repo = repoOfValue(m.Repository ?? m.Repo);
    if (!repo) continue;
    const names = [p.name, ...(m.Aliases ?? '').split(',')].map((s) => s.trim().toLowerCase()).filter(Boolean);
    for (const n of names) out[n] ??= repo;
  }
  return out;
}

/** The repo a bare `#123` or `PR 123` means: the link's repo, else the project's. */
export function repoFor(link: string | undefined, project: string | undefined, repos: RepoMap = {}): string | undefined {
  return repoOfUrl(link) ?? (project ? repos[project.toLowerCase()] : undefined);
}

const ghLink = (repo: string, n: string, pr: boolean) => `https://github.com/${repo}/${pr ? 'pull' : 'issues'}/${n}`;

/** The text split into plain strings and links. Unresolved references stay in the plain text. */
export function autolink(text: string, ctx: LinkCtx = {}): Seg[] {
  const out: Seg[] = [];
  const repos = ctx.repos ?? {};
  let last = 0;
  const re = new RegExp(RE.source, RE.flags);
  let m: RegExpExecArray | null;
  const push = (start: number, end: number, href: string) => {
    if (start > last) out.push(text.slice(last, start));
    out.push({ href, text: text.slice(start, end) });
    last = end;
  };
  while ((m = re.exec(text))) {
    const start = m.index;
    if (m[1]) {
      // A url's trailing punctuation is the sentence's, not the url's.
      const url = m[1].replace(/[.,;:!?)\]]+$/, '');
      push(start, start + url.length, url);
      re.lastIndex = start + url.length;
    } else if (m[2]) push(start, start + m[0].length, ghLink(m[2], m[3], false));
    else if (m[4]) {
      const word = m[4].toLowerCase();
      const repo = word === 'pr' ? ctx.repo : repos[word];
      if (repo) push(start, start + m[0].length, ghLink(repo, m[5], word === 'pr' || /\sPR\s/i.test(m[0])));
      // Not a reference ("Approve PR 12"): look again one character on, so "PR 12" still matches.
      else re.lastIndex = start + 1;
    } else if (m[6]) { if (ctx.repo) push(start, start + m[0].length, ghLink(ctx.repo, m[6], true)); }
    else if (m[7] && ctx.repo) push(start, start + m[0].length, ghLink(ctx.repo, m[7], false));
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length ? out : [text];
}

let current: RepoMap = {};
/** The app's project map, set once projects load; `Linked` reads it. */
export const setRepoMap = (m: RepoMap): void => { current = m; };
export const repoMap = (): RepoMap => current;
