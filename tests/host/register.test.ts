import { readFileSync } from 'fs';
import { join } from 'path';
import { registerHost } from '../../src/host';
import type { AzureAppLike } from '../../src/api';
import { ENV, principal } from './helpers';

describe('azure-host registration and package', () => {
  /** @req FR:azure-host/routes.register */
  it('registers one anonymous catch-all named api', async () => {
    const calls: { name: string; opts: Parameters<AzureAppLike['http']>[1] }[] = [];
    const app: AzureAppLike = { http: (name, opts) => { calls.push({ name, opts }); } };
    registerHost(app, ENV, { log: () => undefined });
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('api');
    expect(calls[0].opts.route).toBe('{*route}');
    expect(calls[0].opts.authLevel).toBe('anonymous');
    const res = await calls[0].opts.handler({ method: 'GET', url: 'https://swa.test/api/health', headers: new Headers(), text: async () => '' });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
    const denied = await calls[0].opts.handler({ method: 'GET', url: 'https://swa.test/api/next', headers: new Headers({ 'x-ms-client-principal': principal('1') }), text: async () => '' });
    expect(denied.status).toBe(403);
  });

  /** @req FR:azure-host/pkg.layout */
  it('host package is Node 22, v4 model, exact versions', () => {
    const root = join(__dirname, '../../host');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.main).toBe('dist/host/main.js');
    expect(pkg.engines.node).toBe('>=22 <23');
    expect(pkg.dependencies['@azure/functions']).toMatch(/^4\.\d+\.\d+$/);
    for (const [name, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) expect([name, v]).toEqual([name, expect.stringMatching(/^\d+\.\d+\.\d+$/)]);
    expect(JSON.parse(readFileSync(join(root, 'host.json'), 'utf8')).version).toBe('2.0');
    const ignore = readFileSync(join(__dirname, '../../.gitignore'), 'utf8');
    expect(ignore).toMatch(/^dist\/$/m);
    expect(ignore).toMatch(/^node_modules\/$/m);
    const main = readFileSync(join(root, 'main.ts'), 'utf8');
    expect(main).toContain('registerHost');
    expect(main.split('\n').length).toBeLessThan(20);
  });
});
