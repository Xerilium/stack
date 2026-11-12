/**
 * `stack inbox sources [--json]`: each inbox source, its state, last sync and the exact step to connect it. Never a token.
 * @req FR:inbox-page/cli.sources @req FR:inbox-page/src.safe
 */
import type { LifecycleContext } from '../core/lifecycle';
import { probeLocal } from '../inbox/probe';
import { agoText, loadSources, type SourceProbe } from '../inbox/sources';

export async function inboxSourcesCmd(ctx: LifecycleContext, o: { probe?: () => Promise<SourceProbe> } = {}): Promise<{ json: Record<string, unknown>; text: string; code?: number }> {
  const now = (ctx.now ?? (() => new Date()))();
  const { sources, summary } = await loadSources({ storage: ctx.storage, now, probe: o.probe ?? (() => probeLocal()), ...(ctx.config?.inbox ? { inbox: ctx.config.inbox } : {}) });
  const lines = [`${summary.connected} of ${summary.total} sources connected${summary.headline ? ` · ${summary.headline}` : ''}`];
  for (const s of sources) {
    const when = s.lastSyncAt ? `synced ${agoText(s.lastSyncAt, now)}` : 'never synced';
    lines.push(`${s.kind.padEnd(7)} ${(s.account || '-').padEnd(28)} ${s.state}${s.planned ? ' (planned)' : ''}${s.mode ? ` · ${s.mode}` : ''} · ${when}`);
    if (s.error) lines.push(`        ${s.error}`);
    if (s.needs && s.state !== 'ok') lines.push(`        ${s.needs}`);
    if (s.command && s.state !== 'ok') lines.push(`        $ ${s.command}`);
  }
  return { json: { ok: true, sources, summary }, text: lines.join('\n'), ...(summary.attention ? { code: 4 } : {}) };
}
