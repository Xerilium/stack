import { defineConfig } from 'vite';

export default defineConfig({
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
  test: { include: ['tests/**/*.test.{ts,tsx}'], environment: 'node' },
});
