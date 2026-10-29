import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const script = readFileSync(join(root, 'scripts/setup-azure.sh'), 'utf8');
const doc = readFileSync(join(root, 'docs/setup-live.md'), 'utf8');
/** The script's inline node programs, by marker. */
const nodeProgram = (marker: string) => {
  const m = [...script.matchAll(/node -e '([^']+)'/g)].map((x) => x[1]).find((p) => p.includes(marker));
  if (!m) throw new Error(`no node program with ${marker}`);
  return m;
};

// @req FR:live-deploy/setup.script
describe('setup-azure.sh', () => {
  it('is an executable strict bash script', () => {
    expect(script.startsWith('#!/usr/bin/env bash\n')).toBe(true);
    expect(script).toMatch(/^set -euo pipefail$/m);
    expect(statSync(join(root, 'scripts/setup-azure.sh')).mode & 0o111).not.toBe(0);
  });
  it('applies the bicep template only when the site does not exist yet', () => {
    const deploy = script.indexOf('az deployment group create');
    const guard = script.lastIndexOf('if [ "$EXISTS" = 0 ]; then', deploy);
    expect(deploy).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(0);
    expect(script.slice(guard, deploy)).not.toMatch(/\nfi\n/);
    expect(script).toMatch(/-f infra\/main\.bicep/);
  });
  it('only "not there" counts as a new site; any other az failure stops the script', () => {
    expect(script).not.toMatch(/2>\/dev\/null && EXISTS=1/);
    expect(script).toMatch(/^GROUP_EXISTS=\$\(az group exists -n "\$GROUP"\)$/m);
    expect(script).toMatch(/then FOUND=\$\(az staticwebapp list -g "\$GROUP"/);
    expect(script).not.toMatch(/if \[ "\$\(az /);
    expect(script).toMatch(/az staticwebapp list -g "\$GROUP" --query/);
    expect(script).toMatch(/Subscription: /);
  });
  it('a re-run changes the repo URL only when --repo is given', () => {
    expect(script).toMatch(/--repo\) REPO=\$2; REPO_SET=1;/);
    expect(script).toMatch(/STACK_P_URL=\$\(\[ "\$REPO_SET" = 1 \]/);
  });
  it('sets the deploy secret and starts the deploy', () => {
    expect(script).toMatch(/gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN -R/);
    expect(script).toMatch(/gh workflow run deploy\.yml/);
  });
  it('validates every argument before use', () => {
    for (const f of ['--repo', '--app', '--group', '--name', '--location', '--owner']) expect(script).toMatch(new RegExp(`\\|\\| bad ${f} `));
  });
  it('re-run merges only the changed settings and keeps the rest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stack-setup-test-'));
    try {
      writeFileSync(join(dir, 'cur.json'), JSON.stringify({ STACK_OWNERS: '', STACK_SLACK_SIGNING_SECRET: 'keep', STACK_REPO_TOKEN: 'old', STACK_TOKEN_PEPPER: 'pep' }));
      const run = (env: Record<string, string>) => {
        execFileSync('node', ['-e', nodeProgram('p.STACK_OWNERS = '), join(dir, 'cur.json'), join(dir, 'body.json')], { env: { PATH: process.env.PATH!, ...env } });
        return JSON.parse(readFileSync(join(dir, 'body.json'), 'utf8')).properties;
      };
      expect(run({ STACK_P_OWNERS: 'github:abc', STACK_P_URL: '', STACK_P_TOKEN: '' })).toEqual({ STACK_OWNERS: 'github:abc', STACK_SLACK_SIGNING_SECRET: 'keep', STACK_REPO_TOKEN: 'old', STACK_TOKEN_PEPPER: 'pep' });
      expect(run({ STACK_P_OWNERS: '', STACK_P_URL: 'https://github.com/a/b', STACK_P_TOKEN: 'new' })).toMatchObject({ STACK_OWNERS: '', STACK_REPO_TOKEN: 'new', STACK_REPO_URL: 'https://github.com/a/b', STACK_SLACK_SIGNING_SECRET: 'keep', STACK_TOKEN_PEPPER: 'pep' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// @req FR:live-deploy/setup.secrets
describe('setup secrets', () => {
  it('reads the token hidden, checks contents access, keeps secrets in a mode-600 temp folder it deletes, pipes the deploy key on stdin', () => {
    expect(script).toMatch(/read -r -s -p/);
    expect(script).toMatch(/git\/ref\/heads\/\$BRANCH/);
    expect(script).toMatch(/umask 077/);
    expect(script).toMatch(/mktemp -d/);
    expect(script).toMatch(/trap 'rm -rf "\$TMP"' EXIT/);
    expect(script).toMatch(/--query properties\.apiKey -o tsv \| gh secret set/);
    expect(script).toMatch(/--body "@\$TMP\/body\.json"/);
  });
  it('never prints a secret or puts one on a command line', () => {
    for (const line of script.split('\n').filter((l) => /^\s*(echo|printf|say)\b/.test(l))) expect(line).not.toMatch(/\$(TOKEN|PEPPER)\b/);
    for (const line of script.split('\n').filter((l) => /^\s*(az|gh) /.test(l))) expect(line).not.toMatch(/\$\{?(TOKEN|PEPPER)\b/);
  });
  it('builds parameter JSON in node, so any value is encoded safely', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stack-setup-test-'));
    try {
      execFileSync('node', ['-e', nodeProgram('deploymentParameters'), join(dir, 'p.json')], { env: { PATH: process.env.PATH!, STACK_P_NAME: 'n', STACK_P_LOCATION: 'westus2', STACK_P_OWNERS: '', STACK_P_PEPPER: 'p', STACK_P_URL: 'https://github.com/a/b', STACK_P_TOKEN: 'a"b\\c' } });
      const p = JSON.parse(readFileSync(join(dir, 'p.json'), 'utf8')).parameters;
      expect(p.repoToken.value).toBe('a"b\\c');
      expect(Object.keys(p).sort()).toEqual(['location', 'name', 'owners', 'repoToken', 'repoUrl', 'tokenPepper']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// @req FR:live-deploy/setup.owner
describe('owner claim', () => {
  it('--owner on an existing site only updates the allow-list', () => {
    expect(script).toMatch(/if \[ -n "\$OWNER" \] && \[ "\$EXISTS" = 1 \]; then\n\s+ONLY_OWNER=1/);
    const only = script.indexOf('if [ "$ONLY_OWNER" = 1 ]; then\n  say "Done"');
    expect(only).toBeGreaterThan(0);
    expect(script.indexOf('gh secret set')).toBeGreaterThan(only);
  });
});

// @req FR:live-deploy/setup.doc
describe('setup doc', () => {
  it('lists the human-only steps with exact clicks and the least-privilege token', () => {
    expect(doc).toMatch(/personal-access-tokens\/new\?[^)]*contents=write/);
    expect(doc).toMatch(/Only select repositories/);
    expect(doc).toMatch(/scripts\/setup-azure\.sh/);
    expect(doc).toMatch(/--owner github:/);
    expect(doc).toMatch(/Install this site as an app/);
    expect(doc).toMatch(/## Undo or rotate/);
  });
});
