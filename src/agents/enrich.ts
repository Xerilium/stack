/**
 * Ask the task's agent to fill in a row that fails the quality gate: one open `enrich` inbox entry per row, to the agent delivery picks.
 * @req FR:product-reset/quality.enrich @req FR:product-reset/api.enrich
 */
import { listTeam } from '../core/agents';
import { currentRows, listInbox, sendToInbox } from '../core/inbox';
import type { LifecycleContext, TaskRef } from '../core/lifecycle';
import { parseProject } from '../core/parser';
import { checkTask, type Check } from '../core/quality';
import { ConflictError, NotFoundError } from '../core/storage';
import { deliveryAgent } from './delivery';
import { taskContext } from './team';

export interface EnrichResult { id: string; agent: string; missing: Check[] }

const baseName = (p: string) => p.replace(/^.*\//, '').replace(/\.md$/, '');

/** The one-line message the agent gets: the missing checks, the rubric, and the gate to run. */
export const enrichText = (ref: TaskRef, missing: Check[]): string =>
  `Fill in this task so it passes the quality gate. Missing: ${missing.join(', ')}. Edit only this row and its fields (Next:, Done when:, Context:, Links:, Owner:) per docs/task-rubric.md; do not do the work; keep the title words (split a two-action title into child rows). Run stack check ${ref.path}:${ref.line + 1} until it scores 4, then reply on the task.`;

/**
 * Sends the enrich message for the row at `ref`, or returns the one still open on that row.
 * A row that scores 4 or is done is a conflict; a missing row is not found.
 */
export async function enrichTask(ctx: LifecycleContext, ref: TaskRef): Promise<EnrichResult> {
  const p = parseProject((await ctx.storage.read(ref.path)).content);
  const q = checkTask(p, ref.line);
  if (!q) throw new NotFoundError('Task not found');
  if (q.actionable) throw new ConflictError('Task is already actionable');
  if (/^\s*- \[[xX]\]/.test(p.lines[ref.line])) throw new ConflictError('Task is done');
  const c = await taskContext(ctx, ref);
  const agent = deliveryAgent(await listTeam(ctx), c.project, c.section);
  if (!agent) throw new NotFoundError(`No agent for ${c.project}`);
  const here = `${ref.path}:${ref.line + 1}`;
  const open = (await listInbox(ctx, { project: baseName(ref.path) })).filter((e) => e.kind === 'enrich');
  if (open.length) {
    const rows = await currentRows(ctx, open);
    const same = open.find((e) => rows.get(e.id) === here);
    if (same) return { id: same.id, agent: same.agent ?? agent.slug, missing: q.missing };
  }
  const { id } = await sendToInbox(ctx, ref, enrichText(ref, q.missing), 'enrich', undefined, undefined, agent.slug);
  return { id, agent: agent.slug, missing: q.missing };
}
