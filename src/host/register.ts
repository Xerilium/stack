import { registerAzure, type AzureAppLike } from '../api';
import { createHost, type HostDeps } from './runtime';
import type { Env } from './settings';

/** One catch-all function; the host routes and authorizes. @req FR:azure-host/routes.register */
export function registerHost(app: AzureAppLike, env: Env, deps: HostDeps = {}): void {
  registerAzure(app, createHost(env, deps), 'api');
}
