import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Local escape hatch: reuse an already-installed Chromium instead of downloading one.
const local = process.env.STACK_E2E_CHROMIUM;
// Local escape hatch: another preview may already hold 4173.
const port = Number(process.env.STACK_E2E_PORT ?? 4173);
const launchOptions = local && existsSync(local) ? { executablePath: local } : {};

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, launchOptions, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
  ],
  webServer: { command: `pnpm run build && pnpm exec vite preview --port ${port} --strictPort`, url: `http://localhost:${port}`, reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
