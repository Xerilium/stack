// @req FR:web-app/host.static @req FR:web-app/host.swa (public/staticwebapp.config.json ships in dist)
// @req FR:web-app/arch.deps (web/package.json: preact only at runtime) @req FR:web-app/arch.tsconfig (web/tsconfig.json is separate from the root configs)
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Preview serves the same security headers SWA applies, so e2e catches CSP violations.
const headers = (JSON.parse(readFileSync(new URL('./public/staticwebapp.config.json', import.meta.url), 'utf8')) as { globalHeaders: Record<string, string> }).globalHeaders;

// The bundled Fluent Emoji art ships with its MIT notice: web/dist goes to Azure and into the desktop app.
const notices = { name: 'third-party-notices', generateBundle(this: { emitFile: (f: { type: 'asset'; fileName: string; source: string }) => string }) {
  this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.md', source: readFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8') });
} };

export default defineConfig({
  plugins: [notices],
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
  preview: { headers },
  test: { include: ['tests/**/*.test.{ts,tsx}'], environment: 'node' },
});
