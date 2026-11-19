module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // A busy machine (several checkouts running this suite at once) can freeze a worker for seconds in the middle of a file read or write.
  // 5 s then fails a test that takes 10 ms alone; 20 s does not, and a real hang still fails. Speed has its own tests (perf-budget).
  testTimeout: 20_000,
  // Locally, half the cores: a full-width run starves the other runs on the machine. CI keeps the Jest default.
  ...(process.env.CI ? {} : { maxWorkers: '50%' }),
  // The ACP SDK is ESM-only: compile just its JS to CommonJS for tests (the real driver loads it with a native import()).
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.js$': ['ts-jest', { tsconfig: { allowJs: true, module: 'commonjs', skipLibCheck: true }, diagnostics: false }],
  },
  transformIgnorePatterns: ['/node_modules/(?!\\.pnpm/@agentclientprotocol|@agentclientprotocol)'],
  setupFiles: ['<rootDir>/tests/setup-env.ts'],
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
