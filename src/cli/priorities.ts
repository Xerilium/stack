/**
 * `stack priorities`: the owner's priorities report (QM, Now, PRs, Today, Next 3 days) as markdown, read live. Read only.
 * @req FR:priorities-tables/cli.@cli
 */
import { githubRepos } from '../api/github';
import { createGitHubAuth } from '../api/github-auth';
import { createPrPage } from '../api/pr-page';
import type { StackConfig } from '../core/config';
import { LiveStore } from '../core/live-lane';
import { boardInput, prioritiesView, timeText, type BoardInput, type PriRow, type PrRow, type SessionsInput } from '../core/priorities-view';
import { PriStore } from '../core/pris';
import { runInventory } from '../core/session-inventory';
import { FsStorage } from '../core/storage';
import { readTieredTasks, type AgentStatus, type TieredTask } from '../core/tiered-tasks';
import { UsageError } from './args';

export interface PrioritiesDeps {
  home: string; timeZone?: string; now: () => Date;
  /** Tiered tasks from every task file. */
  tasks: () => Promise<TieredTask[]>;
  /** The session inventory; undefined when it cannot be read. */
  inventory: () => SessionsInput | undefined;
  /** The PR board; undefined with no GitHub sign-in or on a failed read. */
  board: () => Promise<BoardInput | undefined>;
}

/**
 * The live sources of the CLI: pris.json, the task files in `dir`, the session store and GitHub; no board without a GitHub sign-in.
 * @req FR:priorities-tables/cli.read @req FR:priorities-tables/cli.read.board @req FR:priorities-tables/tasks.store
 */
export function liveDeps(home: string, dir: string, config: () => StackConfig | undefined, env: NodeJS.ProcessEnv = process.env, at?: Date): PrioritiesDeps {
  let cfg: StackConfig | undefined;
  try { cfg = config(); } catch { cfg = undefined; }
  return {
    home, timeZone: cfg?.timezone, now: () => at ?? new Date(),
    tasks: () => readTieredTasks(new FsStorage(dir)),
    inventory: () => { try { const i = runInventory({ home }); return { at: i.at, sessions: i.sessions }; } catch { return undefined; } },
    board: async () => {
      const tok = await createGitHubAuth({ env }).token();
      if (!tok) return undefined;
      const page = createPrPage({ token: tok, repos: githubRepos(env.STACK_GITHUB_REPOS), config: cfg, home, inventory: () => runInventory({ home }), adminOrgs: true, live: () => new LiveStore(home).view() });
      try { return boardInput(await page.prBoard.get()); } catch { return undefined; } finally { page.prBoard.stop(); }
    },
  };
}

export const STATUS_TEXT: Record<AgentStatus, string> = { working: '🔄 Working', pairing: '🤝 Pairing', done: '✅ Done', idle: '⏸️ Idle', blocked: '🚫 Blocked', queued: '🕓 Queued', unknown: '❓ Unknown' };
const PRI_HEAD = ['| Project | Agent | 🤖 Status | 👱‍♂️ Next action |', '| --- | --- | --- | --- |'];
const PR_HEAD = ['| PR | Agent | 👱‍♂️ Next action | Time |', '| --- | --- | --- | --- |'];
const cell = (s: string) => s.replace(/\|/g, '\\|');
const agentText = (a: { name: string; link: string | null } | null) => (!a ? '--' : a.link ? `[${cell(a.name)}](${a.link})` : cell(a.name));
const priLine = (r: PriRow) => `| ${cell(r.project)} | ${agentText(r.agent)} | ${r.status ? STATUS_TEXT[r.status] : '--'} | ${r.gap ? 'Gap: ' : ''}${cell(r.action)} |`;
/** Live rows add the server and details links. @req FR:priorities-tables/pr.cols.live */
const liveLinks = (r: PrRow) => [r.server ? `[server](${r.server})` : '', r.details ? `[details](${r.details})` : ''].filter(Boolean).join(', ');
const prLine = (r: PrRow) => `| ${r.emoji ? `${r.emoji} ` : ''}[${r.number}](${r.url}) | ${agentText(r.agent)} | ${liveLinks(r) ? `Live: ${liveLinks(r)}` : r.action} | ${r.minutes}m |`;

/** @req FR:priorities-tables/cli.text */
function section(title: string, t: { at: string; stale: boolean }, body: string[], tz?: string): string[] {
  return ['---', `## ${title} (as of ${timeText(t.at, tz)}${t.stale ? ', stale' : ''})`, '', ...body];
}

/** @req FR:priorities-tables/cli.read @req FR:priorities-tables/cli.text @req FR:priorities-tables/cli.json */
export async function prioritiesCmd(_flags: Record<string, string | true>, positionals: string[], d: PrioritiesDeps): Promise<{ json: Record<string, unknown>; text: string; code?: number }> {
  if (positionals.length) throw new UsageError(`Unexpected argument: ${positionals[0]}`);
  const [board, tasks, sessions] = [await d.board(), await d.tasks(), d.inventory()];
  const v = prioritiesView({ pris: new PriStore(d.home).read().pris, tasks, now: d.now(), timeZone: d.timeZone, ...(sessions ? { sessions } : {}), ...(board ? { board } : {}) });
  const pri = (rows: PriRow[]) => (rows.length ? [...PRI_HEAD, ...rows.map(priLine)] : ['Nothing here']);
  const parts = [
    ...(v.qm ? [section(v.qm.title, v.qm, pri(v.qm.rows), d.timeZone)] : []),
    section('Now', v.now, pri(v.now.rows), d.timeZone),
    section('PRs', v.prs, [...(v.prs.manager ? [`👩‍💻 ${agentText(v.prs.manager)}`, ''] : []), ...(!v.prs.verified ? ['Not verified live'] : v.prs.rows.length ? [...PR_HEAD, ...v.prs.rows.map(prLine)] : ['Nothing here'])], d.timeZone),
    section('Today', v.today, pri(v.today.rows), d.timeZone),
    section('Next 3 days', v.next, pri(v.next.rows), d.timeZone),
  ];
  return { json: { ok: true, ...v }, text: parts.map((p) => p.join('\n')).join('\n\n') };
}
