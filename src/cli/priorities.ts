/**
 * `stack priorities`: the owner's priorities as four tables (Now, Promote to Autopilot, Today, Next 3 days), read live. Read only.
 * @req FR:priorities-tables/cli.@cli
 */
import { githubRepos } from '../api/github';
import { createGitHubAuth } from '../api/github-auth';
import { createPrPage } from '../api/pr-page';
import type { StackConfig } from '../core/config';
import { LiveStore } from '../core/live-lane';
import { boardInput, prioritiesView, timeText, type BoardInput, type PriTable, type PrTable, type SessionsInput } from '../core/priorities-view';
import { PriStore } from '../core/pris';
import { runInventory } from '../core/session-inventory';
import { UsageError } from './args';

export interface PrioritiesDeps {
  home: string; timeZone?: string; now: () => Date;
  /** The session inventory; undefined when it cannot be read. */
  inventory: () => SessionsInput | undefined;
  /** The PR board; undefined with no GitHub sign-in or on a failed read. */
  board: () => Promise<BoardInput | undefined>;
}

/**
 * The live sources of the CLI: pris.json, the session store and GitHub; no board without a GitHub sign-in.
 * @req FR:priorities-tables/cli.read @req FR:priorities-tables/cli.read.board
 */
export function liveDeps(home: string, config: () => StackConfig | undefined, env: NodeJS.ProcessEnv = process.env, at?: Date): PrioritiesDeps {
  let cfg: StackConfig | undefined;
  try { cfg = config(); } catch { cfg = undefined; }
  return {
    home, timeZone: cfg?.timezone, now: () => at ?? new Date(),
    inventory: () => { try { const i = runInventory({ home }); return { at: i.at, sessions: i.sessions }; } catch { return undefined; } },
    board: async () => {
      const tok = await createGitHubAuth({ env }).token();
      if (!tok) return undefined;
      const page = createPrPage({ token: tok, repos: githubRepos(env.STACK_GITHUB_REPOS), config: cfg, home, inventory: () => runInventory({ home }), adminOrgs: true, live: () => new LiveStore(home).view() });
      try { return boardInput(await page.prBoard.get()); } catch { return undefined; } finally { page.prBoard.stop(); }
    },
  };
}

const TITLES = { now: 'Now', autopilot: 'Promote to Autopilot', today: 'Today', next: 'Next 3 days' } as const;

/** @req FR:priorities-tables/cli.text */
function tableText(title: string, t: PriTable | PrTable, tz?: string): string[] {
  const rows = t.rows.map((r) => ('number' in r ? `${r.project} | [${r.number}](${r.url}) | ${r.title}` : `${r.project} | ${r.agent?.name ?? '--'} | ${r.action}`));
  return [`${title} (as of ${timeText(t.at, tz)}${t.stale ? ', stale' : ''})`, ...(rows.length ? rows : ['(none)'])];
}

/** @req FR:priorities-tables/cli.read @req FR:priorities-tables/cli.text @req FR:priorities-tables/cli.json */
export async function prioritiesCmd(_flags: Record<string, string | true>, positionals: string[], d: PrioritiesDeps): Promise<{ json: Record<string, unknown>; text: string; code?: number }> {
  if (positionals.length) throw new UsageError(`Unexpected argument: ${positionals[0]}`);
  const [board, sessions] = [await d.board(), d.inventory()];
  const v = prioritiesView({ pris: new PriStore(d.home).read().pris, now: d.now(), timeZone: d.timeZone, ...(sessions ? { sessions } : {}), ...(board ? { board } : {}) });
  const text = (['now', 'autopilot', 'today', 'next'] as const).flatMap((k) => tableText(TITLES[k], v[k], d.timeZone)).join('\n');
  return { json: { ok: true, ...v }, text };
}
