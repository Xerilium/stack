/**
 * App settings -> typed host config. Errors name settings, never values.
 * @req FR:azure-host/settings.parse @req FR:azure-host/settings.invalid @req FR:azure-host/settings.deny
 */
import { tmpdir } from 'os';
import { join, isAbsolute } from 'path';
import { parseOwners, type Owner } from '../api/auth';
import { getDefaults, parseConfig, type StackConfig } from '../core/config';

export type Env = Record<string, string | undefined>;

export class SettingsError extends Error {
  constructor(readonly names: string[]) { super(`Invalid settings: ${names.join(', ')}`); }
}

export interface Channel { secret: string; allow: string[] }
export interface HostSettings {
  repoUrl: string;
  branch: string;
  /** Relative subfolder inside the repo ('' = repo root). */
  path: string;
  repoToken: string;
  owners: Owner[];
  tokenStore: string;
  pepper?: string;
  config: StackConfig;
  gitName: string;
  gitEmail: string;
  bots: {
    slack?: { signingSecret: string; allow: string[] };
    imessage?: Channel;
    webhook?: Channel;
    github?: Channel;
  };
}

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
const val = (env: Env, k: string) => { const v = env[k]; return v === undefined || v.trim() === '' ? undefined : v.trim(); };

function validUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname !== '' && u.username === '' && u.password === '' && u.search === '' && u.hash === '';
  } catch { return false; }
}
const validBranch = (b: string) => /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(b) && !b.includes('..') && !b.endsWith('/') && !b.endsWith('.lock');
function validPath(p: string): boolean {
  if (p === '') return true;
  if (!/^[A-Za-z0-9._/-]+$/.test(p) || p.startsWith('/')) return false;
  return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..' && s.toLowerCase() !== '.git');
}

export function parseSettings(env: Env): HostSettings {
  const bad: string[] = [];
  const repoUrl = val(env, 'STACK_REPO_URL');
  if (!repoUrl || !validUrl(repoUrl)) bad.push('STACK_REPO_URL');
  const repoToken = val(env, 'STACK_REPO_TOKEN');
  if (!repoToken || !/^[\x21-\x7e]+$/.test(repoToken)) bad.push('STACK_REPO_TOKEN');
  const branch = val(env, 'STACK_REPO_BRANCH') ?? 'main';
  if (!validBranch(branch)) bad.push('STACK_REPO_BRANCH');
  const path = (val(env, 'STACK_REPO_PATH') ?? '').replace(/\/+$/, '');
  if (!validPath(path)) bad.push('STACK_REPO_PATH');
  const tokenStore = val(env, 'STACK_TOKEN_STORE') ?? join(tmpdir(), 'stack-tokens.json');
  if (!isAbsolute(tokenStore)) bad.push('STACK_TOKEN_STORE');
  let config = getDefaults();
  const rawConfig = val(env, 'STACK_CONFIG');
  if (rawConfig) {
    try { config = parseConfig(JSON.parse(rawConfig)); } catch { bad.push('STACK_CONFIG'); }
  }
  if (bad.length) throw new SettingsError(bad);

  const channel = (secret: string, allow: string): Channel | undefined => {
    const s = val(env, secret);
    return s ? { secret: s, allow: list(env[allow]) } : undefined;
  };
  const slackSecret = val(env, 'STACK_SLACK_SIGNING_SECRET');
  return {
    repoUrl: repoUrl!, branch, path, repoToken: repoToken!, tokenStore, config,
    owners: parseOwners(env['STACK_OWNERS']),
    pepper: val(env, 'STACK_TOKEN_PEPPER'),
    gitName: val(env, 'STACK_GIT_NAME') ?? 'Stack',
    gitEmail: val(env, 'STACK_GIT_EMAIL') ?? 'stack@users.noreply.github.com',
    bots: {
      slack: slackSecret ? { signingSecret: slackSecret, allow: list(env['STACK_SLACK_ALLOW']) } : undefined,
      imessage: channel('STACK_IMESSAGE_SECRET', 'STACK_IMESSAGE_ALLOW'),
      webhook: channel('STACK_WEBHOOK_SECRET', 'STACK_WEBHOOK_ALLOW'),
      github: channel('STACK_GITHUB_WEBHOOK_SECRET', 'STACK_GITHUB_WEBHOOK_ALLOW'),
    },
  };
}
