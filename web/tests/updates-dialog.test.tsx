// @vitest-environment jsdom
import { render } from 'preact';
import { describe, expect, it } from 'vitest';
import { UpdatesDialog } from '../src/UpdatesView';
import type { UpdateMode, VersionState } from '../src/update';

const STAMP = { version: '0.0.1', sha: 'bbbbbbbbbbbb', dirty: false, builtAt: '2026-11-12T10:00:00.000Z' };
const state = (o: Partial<VersionState> = {}): VersionState => ({ running: { ...STAMP, sha: 'aaaaaaaaaaaa' }, available: STAMP, ready: true, mode: 'on-quit', idleMinutes: 30, canRestart: true, last: null, ...o });

function mount(s: VersionState, restarting = false) {
  const root = document.createElement('div'); document.body.append(root);
  const modes: UpdateMode[] = []; let restarts = 0; let closes = 0;
  render(<UpdatesDialog state={s} restarting={restarting} onClose={() => { closes++; }} onMode={(m) => modes.push(m)} onRestart={() => { restarts++; }} />, root);
  const button = (label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === label);
  return { root, modes, restarts: () => restarts, closes: () => closes, button };
}

describe('Updates dialog', () => {
  // @req FR:devops-installer/notice.dialog @req FR:devops-installer/notice.words
  it('lists the four modes in plain words with the current one checked, and both builds', () => {
    const m = mount(state({ mode: 'ask' }));
    const labels = [...m.root.querySelectorAll('label')].map((l) => l.textContent);
    expect(labels).toEqual(['When I quit Stack (recommended)', 'Only when I select Restart', "When I'm away for 30 minutes", 'Never']);
    expect(m.root.querySelector<HTMLInputElement>('input[value="ask"]')?.checked).toBe(true);
    expect(m.root.textContent).toContain('aaaaaaaaaaaa');
    expect(m.root.textContent).toContain('bbbbbbbbbbbb');
    m.root.querySelector<HTMLInputElement>('input[value="off"]')!.click();
    expect(m.modes).toEqual(['off']);
  });
  // @req FR:devops-installer/notice.restart @req FR:devops-installer/notice.dialog
  it('offers Restart now only when an update is ready and the host can restart', () => {
    const m = mount(state());
    m.button('Restart now')!.click();
    expect(m.restarts()).toBe(1);
    expect(mount(state({ ready: false })).button('Restart now')).toBeUndefined();
    expect(mount(state({ canRestart: false })).button('Restart now')).toBeUndefined();
    expect(mount(state(), true).button('Restarting…')?.disabled).toBe(true);
  });
  // @req FR:devops-installer/notice.dialog
  it('says when the last update failed', () => {
    expect(mount(state({ ready: false, last: { ok: false, step: 'launch', at: 'x' } })).root.textContent).toContain('Failed at launch; rolled back');
  });
});
