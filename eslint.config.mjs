import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.xe/**', 'jest.config.js'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // BOM characters are used intentionally in the parser and its tests
    rules: {
      'no-irregular-whitespace': ['error', { skipRegExps: true, skipTemplates: true, skipStrings: true }],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  }
);
