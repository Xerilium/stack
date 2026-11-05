/** @req FR:desktop-app/install.prompt @req FR:desktop-app/install.prompt.done @req FR:desktop-app/install.prompt.none @req FR:desktop-app/install.shortcuts */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createInstall } from '../src/install';

const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));

describe('manifest', () => {
  it('lists shortcuts for Needs you and My day', () => {
    const urls = manifest.shortcuts.map((s: { url: string }) => s.url);
    expect(urls).toEqual(['/#/asks', '/#/today']);
    expect(manifest.shortcuts.map((s: { name: string }) => s.name)).toEqual(['Needs you', 'My day']);
    for (const s of manifest.shortcuts) expect(s.icons[0].src).toBe('/icons/icon-192.png');
    expect(manifest.categories).toContain('productivity');
  });
});

const evt = () => ({ preventDefault: vi.fn(), prompt: vi.fn().mockResolvedValue(undefined), userChoice: Promise.resolve({ outcome: 'accepted' }) });

describe('install state', () => {
  it('offers nothing without the event', () => {
    const i = createInstall(false);
    expect(i.available()).toBe(false);
  });
  it('captures the event, prompts once, then drops it', async () => {
    const i = createInstall(false);
    const e = evt();
    i.onBeforeInstall(e as never);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(i.available()).toBe(true);
    await i.run();
    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(i.available()).toBe(false);
    await i.run();
    expect(e.prompt).toHaveBeenCalledTimes(1);
  });
  it('hides after appinstalled', () => {
    const i = createInstall(false);
    i.onBeforeInstall(evt() as never);
    i.onInstalled();
    expect(i.available()).toBe(false);
  });
  it('hides in standalone display', () => {
    const i = createInstall(true);
    i.onBeforeInstall(evt() as never);
    expect(i.available()).toBe(false);
  });
});
