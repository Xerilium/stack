/**
 * `stack prs`: the PR page board in the terminal. Read only. Never prints the token.
 * @req FR:pr-page/cli.prs
 */
import { githubRepos } from '../api/github';
import { createPrPage } from '../api/pr-page';
import { createGitHubAuth } from '../api/github-auth';
import type { PrBoard } from '../api/pr-board-service';
import type { StackConfig } from '../core/config';
import { ACTION_WORD, PR_GROUPS, type PrGroup, type PrRow } from '../core/pr-board';
import { LiveStore } from '../core/live-lane';
import { runInventory } from '../core/session-inventory';
import { UsageError } from './args';
import { specSort } from './pr-review';

const SIGN_IN = 'GitHub sign-in needed: run gh auth login or set GITHUB_TOKEN';
const OWNER: Record<string, string> = { me: 'you', ci: 'CI', runner: 'runner', none: '-' };
const ownerWord = (r: PrRow) => (r.nextAction ? ACTION_WORD[r.nextAction] : r.state.owner === 'reviewer' ? r.state.login ?? 'reviewer' : OWNER[r.state.owner]);

/** Filters a board by group and project (a project name or a repo). */
export function filterBoard(b: PrBoard, group?: string, project?: string): PrRow[] {
  if (group !== undefined && !PR_GROUPS.includes(group as PrGroup)) throw new UsageError(`--group must be one of ${PR_GROUPS.join(', ')}`);
  const p = project?.toLowerCase();
  return b.rows.filter((r) => (!group || r.group === group) && (!p || r.project === p || r.repo.toLowerCase() === p || r.repo.split('/')[1]?.toLowerCase() === p));
}

/** The text form: counts, then one line per row with the next action (else the owner). @req FR:pr-page/cli.prs */
export function formatBoard(b: PrBoard, rows: PrRow[]): string {
  const lines = [`prs: ${PR_GROUPS.map((g) => `${g} ${b.counts[g]}`).join(', ')}; agents ${b.agents.count} (${b.agents.source})${b.at ? `; updated ${b.at}` : ''}${b.error ? `; ${b.error}` : ''}`];
  for (const r of rows) lines.push(`${r.group} [${r.project}] ${r.repo}#${r.number} ${r.title} · ${ownerWord(r)}${r.state.blocker ? `: ${r.state.blocker}` : ''} ${r.state.link}`);
  return lines.join('\n');
}

export async function prsCmd(flags: Record<string, string | true>, positionals: string[], config: () => StackConfig, home: string, env: NodeJS.ProcessEnv = process.env, token: () => Promise<string | null> = () => createGitHubAuth({ env }).token()): Promise<{ json: unknown; text: string; code?: number }> {
  if (positionals.length) throw new UsageError(`Unexpected argument: ${positionals[0]}`);
  const group = typeof flags.group === 'string' ? flags.group : flags.group === true ? '' : undefined;
  const project = typeof flags.project === 'string' ? flags.project : undefined;
  if (group === '') throw new UsageError('--group needs a value');
  const sort = typeof flags.sort === 'string' ? flags.sort : undefined;
  if (flags.sort !== undefined && sort !== 'spec-lines') throw new UsageError('--sort must be spec-lines');
  // GITHUB_TOKEN, else the gh sign-in. @req FR:pr-page/auth.token
  const tok = await token();
  if (!tok) return { json: { ok: false, error: SIGN_IN }, text: `error: ${SIGN_IN}`, code: 1 };
  let cfg: StackConfig | undefined;
  try { cfg = config(); } catch { cfg = undefined; }
  const page = createPrPage({ token: tok, repos: githubRepos(env.STACK_GITHUB_REPOS), config: cfg, home, inventory: () => runInventory({ home }), adminOrgs: true, live: () => new LiveStore(home).view() });
  try {
    const b = await page.prBoard.get();
    const all = filterBoard(b, group, project);
    // Fewest spec lines first, Autopilot rows dropped. @req FR:pr-review-lane/sort.cli
    const rows = sort ? await specSort(all, undefined, home) : all;
    const text = sort ? (rows as Awaited<ReturnType<typeof specSort<PrRow>>>).map((r) => `${r.specLines ?? '?'} ${r.url}${r.live ? ' 🔬' : ''} - ${r.title}`).join('\n') || 'no PRs' : formatBoard(b, rows);
    return { json: { ok: true, ...b, rows }, text, ...(b.at === null ? { code: 1 } : {}) };
  } finally { page.prBoard.stop(); }
}
