// Screenshot helper for the Sessions design review (not a test). Needs `stack web` running with real sessions.
// node e2e/shoot-sessions.mjs <baseURL> <outDir> <prefix> [scene]   scenes: base, drawer, costs, new, stream (needs a running session id in STREAM_ID)
import process from 'node:process';
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const [base, out, prefix, mode = 'base'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const sizes = { desktop: [1440, 900], laptop: [1024, 768], mobile: [390, 844] };
const scenes = {
  base: async () => {},
  drawer: async (p) => { await p.locator('.sess-row').nth(1).click(); await p.locator('.sess-drawer').waitFor(); await p.waitForTimeout(600); },
  costs: async (p) => { await p.getByRole('button', { name: /Costs/ }).click(); await p.waitForTimeout(250); },
  new: async (p) => { await p.getByRole('button', { name: 'New', exact: true }).click(); await p.waitForTimeout(250); },
  stream: async (p) => { await p.locator(`.sess-li[data-id="${process.env.STREAM_ID}"] button`).click(); await p.locator('.sess-drawer').waitFor(); await p.waitForTimeout(Number(process.env.STREAM_WAIT ?? 4000)); },
};
const b = await chromium.launch();
for (const [name, [w, h]] of Object.entries(sizes)) {
  for (const scheme of ['light', 'dark']) {
    if (mode !== 'base' && scheme === 'dark' && name !== 'desktop') continue;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: name === 'mobile' ? 2 : 1, hasTouch: name === 'mobile' });
    const p = await ctx.newPage();
    await p.goto(`${base}/#/sessions`);
    await p.locator('.sess-row, .sess-empty, .sess-error').first().waitFor();
    await p.waitForTimeout(500);
    await scenes[mode](p);
    await p.screenshot({ path: `${out}/${prefix}-${mode}-${name}-${scheme}.png` });
    await ctx.close();
  }
}
await b.close();
