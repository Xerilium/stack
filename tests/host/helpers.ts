import { createHmac } from 'crypto';
import { createHost, type HostDeps } from '../../src/host';
import { MemoryStorage } from '../../src/core/storage';
import { createTokenService, MemoryTokenStore, type Scope } from '../../src/api';

type Init = Omit<RequestInit, "headers"> & { headers?: Record<string, string> };
export const BASE = 'https://swa.test';
export const OWNER = 'github:42';
export const ENV = {
  STACK_REPO_URL: 'https://github.com/acme/tasks.git',
  STACK_REPO_TOKEN: 'ghp_secret_repo_token',
  STACK_OWNERS: OWNER,
  STACK_TOKEN_PEPPER: 'pepper-value',
  STACK_WEBHOOK_SECRET: 'whsec',
  STACK_WEBHOOK_ALLOW: 'ci-bot',
  STACK_SLACK_SIGNING_SECRET: 'slacksec',
  STACK_SLACK_ALLOW: 'U1',
  STACK_GITHUB_WEBHOOK_SECRET: 'ghsec',
  STACK_GITHUB_WEBHOOK_ALLOW: 'octo',
  STACK_IMESSAGE_SECRET: 'imsec',
  STACK_IMESSAGE_ALLOW: '+15551234567',
} as Record<string, string>;

export const principal = (id = '42') => Buffer.from(JSON.stringify({ identityProvider: 'github', userId: id, userDetails: 'x', userRoles: ['anonymous', 'authenticated'] })).toString('base64');

export async function setup(env: Record<string, string | undefined> = ENV, over: Partial<HostDeps> = {}) {
  const storage = new MemoryStorage();
  const logs: string[] = [];
  let opens = 0;
  const store = new MemoryTokenStore();
  const host = createHost(env, {
    openStorage: async () => { opens++; return storage; },
    tokenStore: store,
    log: (l) => logs.push(l),
    ...over,
  });
  const tokens = createTokenService({ store, pepper: env.STACK_TOKEN_PEPPER });
  const mint = async (...scopes: Scope[]) => (await tokens.create({ name: 't', scopes })).token;
  const req = (path: string, init: Init = {}) => host(new Request(`${BASE}${path}`, init));
  const owner = (path: string, init: Init = {}) =>
    req(path, { ...init, headers: { 'x-ms-client-principal': principal(), 'sec-fetch-site': 'same-origin', ...(init.headers ?? {}) } });
  return { host, storage, logs, opens: () => opens, mint, req, owner, tokens };
}

export const hmac = (secret: string, msg: string) => createHmac('sha256', secret).update(msg).digest('hex');
export function signedWebhook(path: string, secret: string, body: object) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  return new Request(`${BASE}${path}`, {
    method: 'POST', body: raw,
    headers: { 'content-type': 'application/json', 'x-stack-timestamp': ts, 'x-stack-signature': `sha256=${hmac(secret, `${ts}.${raw}`)}` },
  });
}
