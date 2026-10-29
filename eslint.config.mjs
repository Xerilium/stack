import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'host/dist/**', 'node_modules/**', 'coverage/**', '.xe/**', 'jest.config.js', 'web/dist/**', 'web/test-results/**', 'web/playwright-report/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // BOM characters are used intentionally in the parser and its tests
    rules: {
      'no-irregular-whitespace': ['error', { skipRegExps: true, skipTemplates: true, skipStrings: true }],
    },
  },
  {
    // The service worker is a plain script in the worker scope.
    files: ['web/public/sw.js'],
    languageOptions: { sourceType: 'script', globals: { self: 'readonly', caches: 'readonly', fetch: 'readonly', Response: 'readonly', Headers: 'readonly', URL: 'readonly' } },
  },
  {
    files: ['tests/**/*.ts', 'web/e2e/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  }
);
