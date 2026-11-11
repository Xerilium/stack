/** Writes GitHub items to `.stack/inbox-items.json` and one ask per actionable item. Never posts. @req FR:connector-github/run.store @req FR:connector-github/run.ask @req FR:connector-github/run.fail */
import { putAsk, oneLine } from '../../core/asks';
import type { LifecycleContext } from '../../core/lifecycle';
import { ConflictError } from '../../core/storage';
import { orderItems } from '../items';
import { MAX_ITEMS } from '../runner';
import { readInbox, writeInbox } from '../store';
import type { GithubConnector, GithubItem } from './github';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3).trimEnd()}...` : s);

async function replaceGithub(ctx: LifecycleContext, fresh: GithubItem[]): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      const cur = (await readInbox(ctx.storage)).filter((x) => x.source !== 'github');
      await writeInbox(ctx.storage, orderItems([...cur, ...fresh]).slice(0, MAX_ITEMS));
      return;
    } catch (e) { if (!(e instanceof ConflictError) || i >= 2) throw e; }
  }
}

/** Replaces stored `github` items. A failed read keeps them. @req FR:connector-github/run.store @req FR:connector-github/run.fail */
export async function runGithub(ctx: LifecycleContext, o: { connector: GithubConnector }): Promise<{ items: number; failed: boolean }> {
  let fresh: GithubItem[];
  try { fresh = (await o.connector.unread()).filter((i) => i.source === 'github'); } catch { return { items: 0, failed: true }; }
  await replaceGithub(ctx, fresh);
  for (const i of fresh) {
    if (i.signal === 'fyi') continue;
    await putAsk(ctx, i.id, {
      from: 'inbox', kind: 'go-do', ask: clip(oneLine(`GitHub: ${i.summary}`), 200), priority: (i.urgency ?? 0) >= 2 ? 'normal' : 'low', reversible: true,
      detail: `Repo: ${i.from}`, ...(i.link ? { link: i.link } : {}),
    }, 'inbox');
  }
  return { items: fresh.length, failed: false };
}
