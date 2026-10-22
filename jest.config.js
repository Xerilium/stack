module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
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
