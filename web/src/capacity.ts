import { isActive } from './now';
import { effortMinutes, parseRow } from './row';
import type { Project, Task } from './types';

/** @req FR:web-app/capacity.view */
export interface CapacityRow { project: string; title: string; open: number; hours: number; capacity: number | null; ratio: number | null; over: boolean }

/** Weekly hours from project metadata: `Weekly capacity`, else the sum of `<Block> capacity`. */
export function capacityHours(meta: Record<string, string>): number | null {
  let sum = 0;
  let found = false;
  for (const [k, v] of Object.entries(meta)) {
    if (!/capacity$/i.test(k.trim())) continue;
    const n = parseFloat(v);
    if (!Number.isFinite(n)) continue;
    if (/^weekly capacity$/i.test(k.trim())) return n;
    sum += n;
    found = true;
  }
  return found ? sum : null;
}

export function capacityRows(projects: Project[], tasks: Task[]): CapacityRow[] {
  return projects.map((p) => {
    const open = tasks.filter((t) => t.project === p.name && !t.done);
    // load is the active work, not the backlog
    const hours = open.filter(isActive).reduce((s, t) => s + effortMinutes(parseRow(t.text).effort), 0) / 60;
    const capacity = capacityHours(p.metadata ?? {});
    const ratio = capacity ? hours / capacity : null;
    return { project: p.name, title: p.title, open: open.length, hours, capacity, ratio, over: ratio !== null && ratio > 1 };
  });
}
