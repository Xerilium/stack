/** Azure Functions host wiring. Package layout: host/package.json, host/host.json, host/main.ts. @req FR:azure-host/pkg.layout */
export { parseSettings, SettingsError, type HostSettings, type Env } from './settings';
export { openGitStorage, gitEnv, applyGitEnv, type GitRunner, type GitDeps } from './git-repo';
export { createHost, botGate, type HostDeps } from './runtime';
export { registerHost } from './register';
export { GitTokenStore, TOKEN_PATH, type HostStorage } from './token-store';
