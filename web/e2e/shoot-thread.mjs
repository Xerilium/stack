// Screenshot helper for the agent-thread design review (not a test). Needs `stack web` running on real data.
// node e2e/shoot-thread.mjs <baseURL> <outDir> <prefix> [scene]   scenes: thread (row expanded with its thread), composer (scrolled to the composer), empty (a row with no thread yet), hero (Home hero thread), norunner
import process from 'node:process';
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const [base, out, prefix, mode = 'thread', refArg = 'flantastic-4:50'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const sizes = { desktop: [1440, 900], laptop: [1024, 768], mobile: [390, 844] };
const row = (p, ref) => p.locator(`.row[data-ref="${ref}"]`);
const scenes = {
  thread: { hash: `#/list?project=${refArg.split(':')[0]}`, go: async (p) => { await row(p, refArg).scrollIntoViewIfNeeded(); await row(p, refArg).click(); await p.keyboard.press('a'); await p.locator('.thread .th-item, .thread .th-note:not(:has-text("Loading"))').first().waitFor(); await p.waitForTimeout(400); await row(p, refArg).scrollIntoViewIfNeeded(); } },
  empty: { hash: `#/list?project=${refArg.split(':')[0]}`, go: async (p) => { await row(p, refArg).click(); await p.keyboard.press('a'); await p.locator('.thread .th-item, .thread .th-note:not(:has-text("Loading"))').first().waitFor(); await p.waitForTimeout(400); } },
  composer: { hash: `#/list?project=${refArg.split(':')[0]}`, go: async (p) => { await row(p, refArg).scrollIntoViewIfNeeded(); await row(p, refArg).click(); await p.keyboard.press('a'); await p.locator('.thread .th-item, .thread .th-note:not(:has-text("Loading"))').first().waitFor(); await p.waitForTimeout(400); await p.locator('.thread .agent-talk').scrollIntoViewIfNeeded(); await p.waitForTimeout(200); } },
  focus: { hash: `#/list?project=${refArg.split(':')[0]}`, go: async (p) => { await row(p, refArg).scrollIntoViewIfNeeded(); await row(p, refArg).click(); await p.keyboard.press('Enter'); await p.locator('.focus-mode .thread .th-item').first().waitFor(); await p.waitForTimeout(400); await p.locator('.focus-mode .thread .agent-talk').scrollIntoViewIfNeeded(); } },
  askcard: { hash: '#/asks', go: async (p) => { await p.locator('.ask-card .ask-task').first().waitFor(); await p.waitForTimeout(300); } },
  hero: { hash: '#/home', go: async (p) => { await p.locator('.focus-block').click(); await p.keyboard.press('a'); await p.locator('.thread .th-item, .thread .th-note:not(:has-text("Loading"))').first().waitFor(); await p.waitForTimeout(400); } },
};
const b = await chromium.launch();
for (const [name, [w, h]] of Object.entries(sizes)) {
  for (const scheme of ['light', 'dark']) {
    if (scheme === 'dark' && name !== 'desktop') continue;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: name === 'mobile' ? 2 : 1, hasTouch: name === 'mobile' });
    const p = await ctx.newPage();
    process.stdout.write(`${mode} ${name} ${scheme}
`);
    await p.goto(`${base}/${scenes[mode].hash}`);
    await p.locator('.row, .focus-block, .ask-card, .asks-empty').first().waitFor();
    await p.waitForTimeout(600);
    await scenes[mode].go(p);
    await p.screenshot({ path: `${out}/${prefix}-${mode}-${name}-${scheme}.png` });
    await ctx.close();
  }
}
await b.close();
