module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // The ACP SDK is ESM-only: compile just its JS to CommonJS for tests (the real driver loads it with a native import()).
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.js$': ['ts-jest', { tsconfig: { allowJs: true, module: 'commonjs', skipLibCheck: true }, diagnostics: false }],
  },
  transformIgnorePatterns: ['/node_modules/(?!\\.pnpm/@agentclientprotocol|@agentclientprotocol)'],
  roots: ['<rootDir>/src', '<rootDir>/tests', '<rootDir>/desktop/src', '<rootDir>/desktop/tests'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
  // Acceptance: core must stay at or above 90% (branches 85%).
  coverageThreshold: {
    './src/core/': { statements: 90, lines: 90, functions: 90, branches: 85 },
  },
};
