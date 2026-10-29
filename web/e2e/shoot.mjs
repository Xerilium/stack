// Screenshot helper for design review (not a test). Needs `stack web` running with demo asks.
// node e2e/shoot.mjs <baseURL> <outDir> <prefix> [states]
import process from 'node:process';
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
const [base, out, prefix, mode = 'base'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const sizes = { desktop: [1440, 900], laptop: [1024, 768], mobile: [390, 844] };
const scenes = {
  base: async () => {},
  decide: async (p) => { await p.keyboard.press('j'); await p.keyboard.press('j'); await p.keyboard.press('j'); await p.waitForTimeout(250); },
  review: async (p) => { await p.keyboard.press('j'); await p.keyboard.press('r'); await p.keyboard.type('Yes, but ask for Net 45'); await p.waitForTimeout(250); },
  detail: async (p) => { await p.keyboard.press('j'); await p.keyboard.press('j'); await p.keyboard.press('e'); await p.waitForTimeout(250); },
  defer: async (p) => { await p.keyboard.press('z'); await p.waitForTimeout(250); },
  sent: async (p) => { await p.keyboard.press('Enter'); await p.waitForTimeout(600); await p.getByRole('button', { name: /Sent/ }).click(); await p.waitForTimeout(250); },
  more: async (p) => { await p.keyboard.press('m'); await p.waitForTimeout(250); },
  footers: async (p) => { await p.keyboard.press('z'); await p.keyboard.press('1'); await p.waitForTimeout(500); await p.keyboard.press('Enter'); await p.waitForTimeout(900); await p.getByRole('button', { name: /Sent/ }).click(); await p.getByRole('button', { name: /Snoozed/ }).click(); await p.waitForTimeout(300); },
  live: async (p) => { execSync(process.env.LIVE_CMD); await p.waitForTimeout(700); },
  answer: async (p) => { await p.keyboard.press('m'); await p.getByRole('button', { name: /Which platform/ }).click(); await p.waitForTimeout(250); },
};
const b = await chromium.launch();
for (const [name, [w, h]] of Object.entries(sizes)) {
  for (const scheme of ['light', 'dark']) {
    if (mode !== 'base' && scheme === 'dark' && name !== 'desktop') continue;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: name === 'mobile' ? 2 : 1, hasTouch: name === 'mobile' });
    const p = await ctx.newPage();
    await p.goto(`${base}/#/asks`);
    await p.locator('.ask-card, .asks-empty').first().waitFor();
    await p.waitForTimeout(400);
    await scenes[mode](p);
    await p.screenshot({ path: `${out}/${prefix}-${mode}-${name}-${scheme}.png` });
    await ctx.close();
  }
}
await b.close();
