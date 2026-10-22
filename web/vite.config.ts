// @req FR:web-app/host.static @req FR:web-app/host.swa (public/staticwebapp.config.json ships in dist)
// @req FR:web-app/arch.deps (web/package.json: preact only at runtime) @req FR:web-app/arch.tsconfig (web/tsconfig.json is separate from the root configs)
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Preview serves the same security headers SWA applies, so e2e catches CSP violations.
const headers = (JSON.parse(readFileSync(new URL('./public/staticwebapp.config.json', import.meta.url), 'utf8')) as { globalHeaders: Record<string, string> }).globalHeaders;

export default defineConfig({
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
  preview: { headers },
  test: { include: ['tests/**/*.test.{ts,tsx}'], environment: 'node' },
});
