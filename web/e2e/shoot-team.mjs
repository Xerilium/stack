// Screenshot helper for the agent-team design review (not a test). Needs `stack web` running on real data.
// node e2e/shoot-team.mjs <baseURL> <outDir> <prefix> [scene]   scenes: list (hover chip), talk (composer open), ask (ask card chip), tiles (Today), drawer
import process from 'node:process';
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const [base, out, prefix, mode = 'list'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const sizes = { desktop: [1440, 900], laptop: [1024, 768], mobile: [390, 844] };
const row = (p, i) => p.locator('.row').nth(i);
const scenes = {
  list: { hash: '#/list?project=flantastic-4', go: async (p) => { await row(p, 1).hover(); await row(p, 1).click(); await p.waitForTimeout(300); } },
  talk: { hash: '#/list?project=flantastic-4', go: async (p) => { await row(p, 1).click(); await p.keyboard.press('a'); await p.waitForTimeout(400); } },
  ask: { hash: '#/asks', go: async (p) => { await p.locator('.ask-card, .asks-empty').first().waitFor(); await p.keyboard.press('a'); await p.waitForTimeout(400); } },
  tiles: { hash: '#/today', go: async (p) => { await p.locator('[data-testid="tops"]').scrollIntoViewIfNeeded(); await p.waitForTimeout(300); } },
  drawer: { hash: '#/list?project=flantastic-4', go: async (p) => { const chip = p.locator('.agent-chip.ok, .agent-chip.accent').first(); await chip.click({ force: true }); await p.waitForTimeout(800); } },
};
const b = await chromium.launch();
for (const [name, [w, h]] of Object.entries(sizes)) {
  for (const scheme of ['light', 'dark']) {
    if (scheme === 'dark' && name !== 'desktop') continue;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: name === 'mobile' ? 2 : 1, hasTouch: name === 'mobile' });
    const p = await ctx.newPage();
    await p.goto(`${base}/${scenes[mode].hash}`);
    await p.locator('.row, .ask-card, .asks-empty, .tiles').first().waitFor();
    await p.waitForTimeout(600);
    await scenes[mode].go(p);
    await p.screenshot({ path: `${out}/${prefix}-${mode}-${name}-${scheme}.png` });
    await ctx.close();
  }
}
await b.close();
