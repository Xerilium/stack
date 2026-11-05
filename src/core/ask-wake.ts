/**
 * Wake file: tells the agent that wrote an ask that the owner answered. A file only, never the network.
 * @req FR:ask-queue/wake.path @req FR:ask-queue/wake.write @req FR:ask-queue/wake.clear @req FR:ask-queue/wake.fail
 */
import type { LifecycleContext } from './lifecycle';
import { ConflictError, NotFoundError } from './storage';

/** `tasks/wake/<slug>.md` for the ask's `from`. */
export function wakePath(from: string): string {
  const slug = from.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 80) || 'agent';
  return `tasks/wake/${slug}.md`;
}

const slugOf = (path: string) => path.replace(/^tasks\/wake\//, '').replace(/\.md$/, '');
const head = (path: string) => `# Wake: ${slugOf(path)}\n\n<!-- stack-wake v1. One line per answered ask: read it with \`stack asks list --state answered\`, act, then handle it. -->\n`;

/** Sets (`answer`) or removes (`null`) the line for `key`. Never throws: the answer must stand. */
export async function updateWake(ctx: LifecycleContext, from: string, key: string, answer: string | null, now: Date): Promise<void> {
  const path = wakePath(from);
  try {
    for (let tries = 0; ; tries++) {
      let cur: { content: string; version: string } | null = null;
      try { cur = await ctx.storage.read(path); } catch (e) { if (!(e instanceof NotFoundError)) throw e; }
      if (!cur && answer === null) return;
      const lines = (cur ? cur.content : head(path)).replace(/\n+$/, '').split('\n').filter((l) => !new RegExp(`^- \\S+ ${key.replace(/[.]/g, '\\.')} `).test(l));
      if (answer !== null) lines.push(`- ${now.toISOString()} ${key} ${answer}`);
      const next = `${lines.join('\n')}\n`;
      if (cur && next === cur.content) return;
      try { await ctx.storage.write(path, next, { expectedVersion: cur ? cur.version : null, message: `Wake: ${key}` }); return; }
      catch (e) { if (!(e instanceof ConflictError) || tries >= 5) throw e; }
    }
  } catch { /* @req FR:ask-queue/wake.fail */ }
}
