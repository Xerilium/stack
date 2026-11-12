/**
 * `stack inbox run [--project p] [--once|--watch] [--json]`: deliver open owner messages to their agents.
 * The command is the opt-in: it runs even when `inbox.delivery` is off.
 * @req FR:agent-delivery/cli.run
 */
import { deliverySettings, DeliveryStore, runDeliveryPass, type DeliveryResult, type LoginState } from '../agents/delivery';
import type { StackConfig } from '../core/config';
import type { LifecycleContext } from '../core/lifecycle';
import { stackHome } from '../core/reports';
import type { Runner } from '../email/llm';
import { UsageError } from './args';

export interface InboxRunDeps {
  repo: string; config?: StackConfig;
  run?: Runner; home?: string; isRepo?: (dir: string) => boolean;
  /** `--watch` stops when this aborts; default `SIGINT`. */
  signal?: AbortSignal; intervalMs?: number;
  /** Lines while watching. */
  out?: (line: string) => void;
}

const line = (r: DeliveryResult) => [r.id, r.state, r.agent || '-', r.reason ?? ''].join(' ').trim();

export async function inboxRunCmd(ctx: LifecycleContext, f: Record<string, string | true>, d: InboxRunDeps): Promise<{ json: Record<string, unknown>; text: string; code?: number }> {
  if (f.once === true && f.watch === true) throw new UsageError('Use --once or --watch, not both');
  const project = typeof f.project === 'string' ? f.project : undefined;
  if (f.project === true) throw new UsageError('--project needs a value');
  const deps = { ctx, settings: deliverySettings(d.config, d.repo), store: new DeliveryStore(d.home ?? stackHome(), ctx.now), repoDir: d.repo, ...(d.run ? { run: d.run } : {}), ...(d.isRepo ? { isRepo: d.isRepo } : {}) };
  if (f.watch !== true) {
    const r = await runDeliveryPass(deps, project ? { project } : {});
    return { json: { ok: r.login !== 'expired', login: r.login, items: r.items }, text: [...r.items.map(line), ...(r.login === 'expired' ? ['Claude login expired: run claude auth login'] : [])].join('\n'), code: r.login === 'expired' ? 1 : 0 };
  }
  const ac = d.signal ? null : new AbortController();
  const signal = d.signal ?? ac!.signal;
  const stop = () => ac?.abort();
  if (ac) process.once('SIGINT', stop);
  const all: DeliveryResult[] = [];
  let login: LoginState = 'unknown';
  try {
    while (!signal.aborted) {
      const r = await runDeliveryPass(deps, project ? { project } : {});
      login = r.login;
      for (const x of r.items) { all.push(x); d.out?.(line(x)); }
      if (signal.aborted) break;
      await new Promise<void>((ok) => { const t = setTimeout(ok, d.intervalMs ?? 30_000); signal.addEventListener('abort', () => { clearTimeout(t); ok(); }, { once: true }); });
    }
  } finally { if (ac) process.off('SIGINT', stop); }
  return { json: { ok: login !== 'expired', login, items: all }, text: '', code: login === 'expired' ? 1 : 0 };
}
