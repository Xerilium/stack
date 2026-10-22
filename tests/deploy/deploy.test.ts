import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';
import { routeScope } from '../../src/api/auth';
import { TOOLS } from '../../src/mcp/tools';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist' || e.startsWith('.git')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// @req FR:deploy-docs/infra.swa @req FR:deploy-docs/infra.settings
describe('bicep', () => {
  const bicep = read('infra/main.bicep');
  it('declares one Free static site and no Key Vault', () => {
    expect(bicep).toMatch(/Microsoft\.Web\/staticSites@/);
    expect(bicep).toMatch(/name:\s*'Free'/);
    expect(bicep).not.toMatch(/KeyVault/i);
    const resources = [...bicep.matchAll(/^resource \w+ '([^']+)'/gm)].map((m) => m[1].split('@')[0]);
    expect(resources).toHaveLength(2); // site + appsettings
    expect(resources.every((r) => r.startsWith('Microsoft.Web/staticSites'))).toBe(true);
  });
  it('marks secrets @secure()', () => {
    for (const p of ['owners', 'tokenPepper', 'repoToken']) {
      expect(bicep).toMatch(new RegExp(`@secure\\(\\)\\s*param ${p} string`));
    }
  });
});

// @req FR:deploy-docs/infra.params
describe('parameter files', () => {
  const declared = [...read('infra/main.bicep').matchAll(/^param (\w+)/gm)].map((m) => m[1]);
  const files = readdirSync(join(root, 'infra')).filter((f) => f.endsWith('.parameters.json'));
  it('exist, parse, and use declared names without secrets', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const j = JSON.parse(read(`infra/${f}`));
      expect(j.$schema).toMatch(/deploymentParameters/);
      for (const k of Object.keys(j.parameters)) {
        expect(declared).toContain(k);
        expect(['owners', 'tokenPepper', 'repoToken']).not.toContain(k);
      }
    }
  });
});

// @req FR:deploy-docs/infra.lint
describe('bicep build', () => {
  const has = spawnSync('bicep', ['--version']).status === 0;
  (has ? it : it.skip)('compiles offline', () => {
    execFileSync('bicep', ['build', join(root, 'infra/main.bicep'), '--stdout'], { stdio: 'pipe' });
  });
});

// @req FR:deploy-docs/ci.valid @req FR:deploy-docs/ci.deploy @req FR:deploy-docs/ci.e2e
describe('workflows', () => {
  const dir = join(root, '.github/workflows');
  const docs = readdirSync(dir).map((f) => [f, parse(read(`.github/workflows/${f}`))] as const);
  it('are valid YAML with name/on/jobs', () => {
    for (const [, d] of docs) {
      expect(d.name).toBeTruthy();
      expect(d.on).toBeTruthy();
      expect(Object.keys(d.jobs).length).toBeGreaterThan(0);
    }
  });
  it('deploy runs on push to main and uses the SWA secret', () => {
    const text = read('.github/workflows/deploy.yml');
    const d = parse(text);
    expect(d.on.push.branches).toEqual(['main']);
    expect(text).toContain('Azure/static-web-apps-deploy');
    expect(text).toContain('secrets.AZURE_STATIC_WEB_APPS_API_TOKEN');
    const steps = d.jobs.deploy.steps as Array<{ id?: string; run?: string; if?: string; uses?: string }>;
    expect(steps.find((s) => s.id === "gate")?.run).toMatch(/SWA_TOKEN.*web\/package\.json/);
    const deploy = steps.find((s) => s.uses?.startsWith("Azure/static-web-apps-deploy"));
    expect(deploy?.if).toBe("steps.gate.outputs.has_token == 'true'");
    expect(text).not.toContain("|| true");
  });
  it("least-privilege permissions and SHA-pinned actions", () => {
    for (const [f, d] of docs) {
      expect(d.permissions).toEqual({ contents: "read" });
      for (const m of read(`.github/workflows/${f}`).matchAll(/uses:\s*(\S+)/g)) expect(m[1]).toMatch(/@[0-9a-f]{40}$/);
    }
  });
  it('e2e runs Playwright on pull requests and guards on web/', () => {
    const text = read('.github/workflows/e2e.yml');
    expect(parse(text).on.pull_request).not.toBeUndefined();
    expect(text).toContain('playwright');
    expect(text).toContain('web/package.json');
  });
});

// @req FR:deploy-docs/docs.links
describe('docs', () => {
  const mds = [join(root, 'README.md'), join(root, 'CONTRIBUTING.md'), ...walk(join(root, 'docs')).filter((f) => f.endsWith('.md'))];
  it('relative links resolve', () => {
    const bad: string[] = [];
    for (const f of mds) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\]\(([^)\s]+)\)/g)) {
        const t = m[1].split('#')[0];
        if (!t || /^[a-z]+:/i.test(t)) continue;
        if (!existsSync(resolve(dirname(f), t))) bad.push(`${f}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  // @req FR:deploy-docs/docs.cli
  it('documents every CLI command', () => {
    const src = read('src/cli/run.ts');
    const cmds = [...src.matchAll(/^ {2}'?([a-z-]+)'?: \{ flags:/gm)].map((m) => m[1]);
    expect(cmds.length).toBeGreaterThan(10);
    const doc = read('docs/cli.md');
    for (const c of cmds) expect(doc).toContain(`\`${c}`);
  });

  // @req FR:deploy-docs/docs.mcp
  it('documents every MCP tool with its scope', () => {
    const doc = read('docs/mcp.md');
    for (const t of TOOLS) {
      const need = routeScope(t.route);
      expect(need).not.toBeNull();
      const row = doc.split("\n").find((l) => l.startsWith(`| \`${t.name}\` |`));
      expect(row).toBeDefined();
      expect(row).toContain(`\`${t.method} ${t.path}\``);
      expect(row).toContain(`\`${need}\``);
    }
    expect(doc).toContain('basePath: "/api/mcp"');
    expect(doc).toMatch(/"mcpServers"/);
  });

  // @req FR:deploy-docs/docs.api
  it('lists every OpenAPI path', () => {
    const spec = parse(read('docs/api/openapi.yaml'));
    const doc = read('docs/api/README.md');
    expect(doc).toContain('openapi.yaml');
    for (const p of Object.keys(spec.paths)) expect(doc).toContain(`\`${p}\``);
  });

  // @req FR:deploy-docs/docs.env
  it('documents every STACK_ variable in the runbook', () => {
    const vars = new Set<string>();
    for (const f of walk(join(root, 'src'))) for (const m of readFileSync(f, 'utf8').matchAll(/STACK_[A-Z_]+/g)) vars.add(m[0]);
    const doc = read('docs/runbook.md');
    for (const v of vars) expect(doc).toContain(v);
  });

  // @req FR:deploy-docs/docs.runbook
  it('runbook covers the required topics', () => {
    const doc = read('docs/runbook.md').toLowerCase();
    for (const k of ['deploy', 'azure_static_web_apps_api_token', 'allow-list', 'rotate', 'backup', 'restore', 'free tier']) {
      expect(doc).toContain(k);
    }
  });

  // @req FR:deploy-docs/docs.process
  it('points to Catalyst and bots docs', () => {
    expect(read('CONTRIBUTING.md')).toMatch(/catalyst/i);
    expect(read('README.md')).toContain('docs/bots/README.md');
  });
});
