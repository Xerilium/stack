# Plan: ACP Agent Driver

Follows `.xe/process/development.md`: spec, failing tests, code, validate.

1. Spec: `spec.md` (this folder). Decisions in `.xe/features/design-decisions.md`.
2. Fixture: `tests/fixtures/fake-acp-agent.js`.
3. Failing tests: `tests/agents/acp.test.ts` (driver, with the real SDK against the fake agent), `tests/cli/agent.test.ts` (command). Each test carries `@req FR:acp-driver/...`.
4. Code: `src/agents/acp.ts` (driver), `src/cli/agent.ts` (command), wiring in `src/cli/run.ts`, export in `src/agents/index.ts`.
5. Jest: transform the SDK's ESM JavaScript to CommonJS for tests only (`jest.config.js`).
6. Validate: targeted tests, `tsc --noEmit`, `eslint` on changed files, traceability for `acp-driver`.

Out of this slice: Electron shell, Tailscale, session resume across processes, wiring the driver into the API's `ApiDeps.agents` (next).
