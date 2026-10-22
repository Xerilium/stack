import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');

// @req FR:auth-security/docs.threat
describe('threat model', () => {
  const doc = readFileSync(join(root, 'docs/security/threat-model.md'), 'utf8');
  it.each(['Assets', 'Trust boundaries', 'Threats', 'Residual risk'])('has a %s section', (h) => {
    expect(doc).toMatch(new RegExp(`^## ${h}`, 'm'));
  });
});

// @req FR:auth-security/docs.swa
describe('SWA config example', () => {
  const cfg = JSON.parse(readFileSync(join(root, 'docs/security/staticwebapp.config.json'), 'utf8'));
  it('lets /api/* reach the Function and blocks other providers', () => {
    const routes = cfg.routes as { route: string; allowedRoles?: string[]; statusCode?: number }[];
    expect(routes.find((r) => r.route === '/api/*')?.allowedRoles).toEqual(['anonymous']);
    for (const p of ['aad', 'twitter', 'google', 'facebook', 'apple']) {
      expect(routes.find((r) => r.route === `/.auth/login/${p}`)?.statusCode).toBe(404);
    }
    expect(cfg.responseOverrides['401'].redirect).toContain('/.auth/login/github');
  });
});
