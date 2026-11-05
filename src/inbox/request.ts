/** "Request this action": a GitHub issue, else a Stack task. Carries source and class only, never message text. @req FR:inbox-page/action.request */
import { execFile } from 'child_process';
import { actionInfo } from './actions';
import { plainTask } from './run';
import type { ActionId, InboxItem, IssueFiler } from './types';

export const REPO = 'Xerilium/stack';
export type RequestResult = { via: 'issue'; url: string } | { via: 'task' };

export async function requestAction(item: InboxItem, action: ActionId, d: { filer: IssueFiler; addTask: (text: string) => Promise<unknown> }): Promise<RequestResult> {
  const info = actionInfo(action);
  if (!info) throw new Error(`Unknown action: ${action}`);
  if (info.ready) throw new Error('This action exists already');
  const title = `Inbox action: ${info.label}`;
  const body = `Requested from the Inbox page.\n\n- Action: \`${action}\`\n- Source: ${item.source}\n- Item kind: ${item.kind ?? 'unknown'}\n\nDescribe the one-click behavior you want here.`;
  try {
    const r = await d.filer.file({ repo: REPO, title, body, labels: ['help wanted'] });
    return { via: 'issue', url: r.url };
  } catch {
    await d.addTask(plainTask(`${title} (${item.source}, ${item.kind ?? 'unknown'})`));
    return { via: 'task' };
  }
}

/** Files the issue with the `gh` CLI. The args are fixed; only title and body vary. */
export function ghIssueFiler(run: (args: string[]) => Promise<string> = (args) => new Promise((ok, no) => execFile('gh', args, (e, out) => (e ? no(e) : ok(out))))): IssueFiler {
  return { async file(i) { const out = await run(['issue', 'create', '--repo', i.repo, '--title', i.title, '--body', i.body, ...i.labels.flatMap((l) => ['--label', l])]); return { url: out.trim().split('\n').pop() ?? '' }; } };
}
