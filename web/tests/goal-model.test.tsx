// @vitest-environment jsdom
/** The goal model on the page (`.xe/features/goal-model/spec.md`). */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { actionable } from '../src/now';
import { legendOf, parseRow } from '../src/row';
import { TaskDetail } from '../src/TaskDetail';
import { ownerOf, type TeamAgent } from '../src/team';
import type { Task } from '../src/types';

const NOW = new Date(2026, 10, 19, 10, 0);
const task = (text: string, notes: string[] = [], project = 'stack'): Task => ({ ref: `tasks/${project}.md:5`, text, project, section: '🔄 Active', done: false, depth: 0, notes });
const agent = (slug: string, o: Partial<TeamAgent> = {}): TeamAgent => ({ slug, name: slug, scope: [], mode: 'ad-hoc', prompt: '', defined: true, source: 'stack', projects: [], ...o });
afterEach(() => { document.body.innerHTML = ''; });

describe('dated marks', () => {
  // @req FR:goal-model/pri.start @req FR:goal-model/pri.hide
  it('a future ⏰ <date> hides the row from Now; on the day it shows', () => {
    expect(parseRow('⏰ 2026-12-01 Plan it').start).toBe('2026-12-01');
    expect(parseRow('⏰ 2026-12-01 Plan it').title).toBe('Plan it');
    expect(actionable(task('⏰ 2026-12-01 Plan it'), NOW)).toBe(false);
    expect(actionable(task('⏰ 2026-11-19 Plan it'), NOW)).toBe(true);
  });

  // @req FR:goal-model/pri.blocked-until @req FR:goal-model/pri.hide
  it('⛔ <date> keeps the blocked status and the date', () => {
    const r = parseRow('⛔️ 2026-12-01 Ship it');
    expect(r).toMatchObject({ status: '⛔️', blockedUntil: '2026-12-01', title: 'Ship it' });
    expect(actionable(task('⛔️ 2026-12-01 Ship it'), NOW)).toBe(false);
  });

  // @req FR:goal-model/pri.hide
  it('a ⛔ date of today or earlier never hides the row; a bare ⛔ does', () => {
    expect(actionable(task('⛔️ 2026-11-19 Ship it'), NOW)).toBe(true);
    expect(actionable(task('⛔️ 2026-11-01 Ship it'), NOW)).toBe(true);
    expect(actionable(task('⛔️ Ship it'), NOW)).toBe(false);
  });
});

describe('legend', () => {
  // @req FR:goal-model/front.legend
  it('shows each legend emoji in the row with its meaning in the task detail', () => {
    const legend = { '🧪': 'needs a live test', '🎨': 'needs design' };
    expect(legendOf('Proofread 🧪', legend)).toEqual([['🧪', 'needs a live test']]);
    expect(legendOf('Proofread', legend)).toEqual([]);
    const root = document.createElement('div'); document.body.append(root);
    const t = task('Proofread 🧪');
    const noop = async () => true;
    act(() => render(<TaskDetail task={t} all={[t]} busy={false} legend={legend} onToggle={() => undefined} onAct={() => undefined} onSave={noop} onSet={noop} onBack={() => undefined} />, root));
    expect([...root.querySelectorAll('[data-testid="legend"]')].map((p) => p.textContent)).toEqual(['🧪 needs a live test']);
  });
});

describe('agent of a task', () => {
  // @req FR:goal-model/agent.inherit @req FR:goal-model/agent.link
  it('a `> agent:` link on the task or a parent wins, then the project lead, then the scopes', () => {
    const team = [agent('cos', { scope: ['*'] }), agent('builder', { scope: ['stack'], projects: ['stack'] }), agent('stack-architect', { name: 'Stack architect', session: 'local_5c1e0a', leads: ['stack'], defined: false, source: 'metadata' })];
    expect(ownerOf(team, task('Do it'))?.name).toBe('Stack architect');
    expect(ownerOf(team, task('Do it', ['> agent: [Docs writer](#local_9f2b11)']))).toMatchObject({ name: 'Docs writer', session: 'local_9f2b11' });
    expect(ownerOf(team, task('Child'), [task('Parent', ['> agent: [Builder](#local_b1)'])])?.slug).toBe('builder');
  });

  // @req FR:goal-model/agent.none
  it('with no link and no lead, the old rules hold', () => {
    const team = [agent('cos', { scope: ['*'] }), agent('builder', { scope: ['stack'], projects: ['stack'] })];
    expect(ownerOf(team, task('Do it'))?.slug).toBe('builder');
  });
});
