import AxeBuilder from '@axe-core/playwright';
import { test } from '@playwright/test';
import { mockApi } from './mock';
for (const scheme of ['light', 'dark'] as const) for (const v of ['today', 'projects', 'list', 'inbox', 'sessions', 'home']) test(`probe ${v} ${scheme}`, async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: scheme });
  const m = await mockApi(page);
  m.sessions = [];
  await page.goto(`/#/${v}`); await page.reload(); await page.waitForTimeout(800);
  const { violations } = await new AxeBuilder({ page }).analyze();
  const out: string[] = [];
  for (const x of violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) for (const n of x.nodes.slice(0, 6)) out.push(`AXE ${x.id} ${n.target.join(' ')} :: ${(n.any[0]?.message ?? '').slice(0, 100)}`);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (ov > 0) out.push(`OVERFLOW ${ov}`);
  if (info.project.name === 'mobile') {
    const small = await page.locator('button:visible, a:visible, [role=button]:visible, input:visible, select:visible').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), c: (e.className || e.tagName) + ' "' + (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24) + '"' }; }).filter((x) => x.h > 0 && (x.h < 44)));
    for (const s of small) out.push(`TAP ${s.h}x${s.w} ${s.c}`);
  }
  console.log(`== ${info.project.name} ${v} ${scheme}\n` + [...new Set(out)].join('\n'));
});
