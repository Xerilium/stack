/** @req FR:web-app/now.active @req FR:web-app/projects.glance @req FR:web-app/list.view */
import { describe, expect, it } from 'vitest';
import { activeTasks, children, progress, topTask, visibleRows } from '../src/now';
import type { Task } from '../src/types';

const t = (ref: string, project: string, section: string, depth = 0, done = false): Task => ({ ref, text: ref, project, section, done, depth, notes: [] });
const all = [
  t('a:1', 'a', '🔄 Active'), t('a:2', 'a', '🔄 Active', 1, true), t('a:3', 'a', '🔄 Active', 1), t('a:4', 'a', '🔄 Active'),
  t('a:6', 'a', '⏭️ Up next'), t('b:1', 'b', '⏭️ Up next'), t('b:2', 'b', '🗄️ Later'), t('c:1', 'c', '🗄️ Later', 0, true), t('c:2', 'c', '🗄️ Later'),
];

describe('now helpers', () => {
  it('lists open top-level Active tasks', () => expect(activeTasks(all).map((x) => x.ref)).toEqual(['a:1', 'a:4']));
  it('counts subtask progress', () => { expect(progress(all, 0)).toEqual({ done: 1, total: 2 }); expect(progress(all, 3)).toEqual({ done: 0, total: 0 }); });
  it('returns children', () => expect(children(all, 'a:1').map((x) => x.ref)).toEqual(['a:2', 'a:3']));
  it('picks the top task: Active, then Up next, then any', () => {
    expect(topTask(all, 'a')?.ref).toBe('a:1');
    expect(topTask(all, 'b')?.ref).toBe('b:1');
    expect(topTask(all, 'c')?.ref).toBe('c:2');
    expect(topTask(all, 'zzz')).toBeUndefined();
  });
  it('hides subtasks until expanded and honors collapsed sections', () => {
    expect(visibleRows(all, all, new Set(), new Set()).map((x) => x.ref)).not.toContain('a:2');
    expect(visibleRows(all, all, new Set(['a:1']), new Set()).map((x) => x.ref)).toContain('a:2');
    expect(visibleRows(all, all, new Set(), new Set(['b/⏭️ Up next'])).map((x) => x.ref)).not.toContain('b:1');
  });
});
