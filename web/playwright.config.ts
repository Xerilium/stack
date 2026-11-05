import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Local escape hatch: reuse an already-installed Chromium instead of downloading one.
const local = process.env.STACK_E2E_CHROMIUM;
const launchOptions = local && existsSync(local) ? { executablePath: local } : {};
// Another checkout's preview may hold 4173; STACK_E2E_PORT picks a free one.
const port = Number(process.env.STACK_E2E_PORT ?? 4173);

// Time-of-day rules (work window, fit) read the clock: pin the zone so a UTC runner past 17:00 does not see an empty day.
process.env.TZ = 'America/Los_Angeles';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  // Each worker is a whole Chromium; more than this starves the page under test on a busy machine and fails on load, not on bugs.
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { timezoneId: 'America/Los_Angeles', baseURL: `http://localhost:${port}`, launchOptions, serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
  ],
  webServer: { command: `pnpm run build && pnpm exec vite preview --port ${port} --strictPort`, url: `http://localhost:${port}`, reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
