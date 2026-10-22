import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

// @req FR:web-app/host.swa
describe('staticwebapp.config.json', () => {
  const web = read('web/public/staticwebapp.config.json');
  const docs = read('docs/security/staticwebapp.config.json');
  it('keeps the security routes and overrides', () => {
    expect(web.routes).toEqual(docs.routes);
    expect(web.responseOverrides).toEqual(docs.responseOverrides);
    expect(web.platform).toEqual(docs.platform);
  });
  it('allow-lists only GitHub and authenticates everything else', () => {
    expect(web.routes.at(-1)).toEqual({ route: '/*', allowedRoles: ['authenticated'] });
    expect(web.routes.filter((r: { route: string }) => r.route.startsWith('/.auth/login')).every((r: { statusCode?: number }) => r.statusCode === 404)).toBe(true);
  });
  it('sets a strict CSP and hardening headers', () => {
    const h = web.globalHeaders;
    expect(h['Content-Security-Policy']).toContain("default-src 'self'");
    expect(h['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(h['Content-Security-Policy']).not.toMatch(/unsafe-inline.*script|script-src[^;]*unsafe/);
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('same-origin');
  });
});

// @req FR:web-app/host.static @req FR:web-app/host.nosecrets
describe('client source', () => {
  const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]));
  const src = files(join(ROOT, 'web/src')).map((f) => readFileSync(f, 'utf8')).join('\n');
  it('has no secrets, env inlining, tokens, or innerHTML', () => {
    expect(src).not.toMatch(/import\.meta\.env/);
    expect(src).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    expect(src).not.toMatch(/localStorage|sessionStorage|x-stack-token|authorization/i);
  });
  it('ships no task data in public files', () => {
    expect(existsSync(join(ROOT, 'web/public'))).toBe(true);
    for (const f of files(join(ROOT, 'web/public'))) expect(readFileSync(f, 'utf8')).not.toMatch(/- \[[ x]\]/);
  });
});

// @req FR:web-app/arch.deps
describe('dependencies', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'web/package.json'), 'utf8'));
  it('has preact as the only runtime dependency and exact versions', () => {
    expect(Object.keys(pkg.dependencies)).toEqual(['preact']);
    for (const v of [...Object.values(pkg.dependencies), ...Object.values(pkg.devDependencies)]) expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Object.keys(pkg.devDependencies).sort()).toEqual(['@playwright/test', '@types/node', 'jsdom', 'typescript', 'vite', 'vitest']);
  });
});

// @req FR:web-app/arch.tsconfig
describe('tsconfig', () => {
  it('is separate from the root configs and never imports src/', () => {
    const ts = JSON.parse(readFileSync(join(ROOT, 'web/tsconfig.json'), 'utf8'));
    expect(ts.extends).toBeUndefined();
    expect(ts.include).not.toContain('../src');
    const files = readdirSync(join(ROOT, 'web/src')).map((f) => readFileSync(join(ROOT, 'web/src', f), 'utf8')).join('\n');
    expect(files).not.toMatch(/from '\.\.\/(\.\.\/)?src|from '\.\.\//);
  });
});

// @req FR:web-app/arch.ci
describe('ci', () => {
  it('runs web unit tests, lint, build, and e2e in its own job', () => {
    const y = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    expect(y).toMatch(/pnpm --filter stack-web test/);
    expect(y).toMatch(/pnpm lint/);
    expect(y).toMatch(/pnpm build/);
    expect(y).toMatch(/e2e:/);
    expect(y).toMatch(/playwright install --with-deps chromium/);
  });
});
