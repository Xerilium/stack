/** The desktop host with first-run setup. Wraps `startHost` without changing it. */
import { readConfig, runLocal, type LocalHost } from '../../src/cli/setup';
import { startWeb } from '../../src/cli/web';
import { defaultWebDir, hostPlan, startHost, type HostDeps, type UserConfig } from './host';

/**
 * The setup server when no repo is set (or the saved repo fails to start), else `startHost` on the same port.
 * User config is read again on every restart, since setup writes it. The port stays the same, so the window keeps its url.
 * @req FR:first-run-onboarding/host.setup @req FR:first-run-onboarding/host.broken @req FR:first-run-onboarding/step.calendar
 */
export async function startLocalHost(o: { home: string; env: NodeJS.ProcessEnv; deps?: HostDeps; port?: number }): Promise<LocalHost> {
  const log = o.deps?.log ?? ((l: string) => console.log(l));
  const cfg = () => readConfig(o.home) as UserConfig & { ics?: unknown };
  const spec = () => { const c = cfg(); return o.env.STACK_REPO || o.env.STACK_DIR || c.repo || c.dir || undefined; };
  const h = await runLocal({
    port: o.port ?? 0, home: o.home, env: o.env, webDir: o.deps?.webDir ?? defaultWebDir(), log, spec,
    startReal: async (port, setup) => {
      const c = cfg();
      const ics = typeof c.ics === 'string' ? c.ics : undefined;
      let dir = '';
      const inner = o.deps?.startWeb ?? startWeb;
      const server = await startHost(hostPlan({ cfg: c, env: o.env, home: o.home }), {
        ...o.deps,
        startWeb: (w) => { dir = w.dir; return inner({ ...w, port, setup, ...(ics ? { ics } : {}) }); },
      });
      return { server, dir };
    },
  });
  // The shell loads 127.0.0.1, as startHost does; both names pass the loopback guard.
  return { get url() { return h.url.replace('//localhost:', '//127.0.0.1:'); }, close: () => h.close(), settled: () => h.settled() };
}
