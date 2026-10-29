import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const script = readFileSync(join(root, 'scripts/setup-azure.sh'), 'utf8');
const doc = readFileSync(join(root, 'docs/setup-live.md'), 'utf8');

// @req FR:live-deploy/setup.script
describe('setup-azure.sh', () => {
  it('is an executable strict bash script', () => {
    expect(script.startsWith('#!/usr/bin/env bash\n')).toBe(true);
    expect(script).toMatch(/^set -euo pipefail$/m);
    expect(statSync(join(root, 'scripts/setup-azure.sh')).mode & 0o111).not.toBe(0);
  });
  it('creates the Free site from the bicep template, sets the deploy secret, and starts the deploy', () => {
    expect(script).toMatch(/az deployment group create [^\n]*-f infra\/main\.bicep/);
    expect(script).toMatch(/gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN -R/);
    expect(script).toMatch(/gh workflow run deploy\.yml/);
    expect(script).toMatch(/owners": \{ "value": "github:\$OWNER_ID" \}/);
  });
  it('is safe to re-run: keeps the pepper and lets Enter keep the token', () => {
    expect(script).toMatch(/PEPPER=\$\{EXISTING_PEPPER:-/);
    expect(script).toMatch(/\[ -z "\$TOKEN" \] && TOKEN=\$EXISTING_TOKEN/);
  });
});

// @req FR:live-deploy/setup.secrets
describe('setup secrets', () => {
  it('reads the token hidden, keeps secrets in a mode-600 temp folder it deletes, pipes the deploy key on stdin', () => {
    expect(script).toMatch(/read -r -s -p/);
    expect(script).toMatch(/umask 077/);
    expect(script).toMatch(/mktemp -d/);
    expect(script).toMatch(/trap 'rm -rf "\$TMP"' EXIT/);
    expect(script).toMatch(/--query properties\.apiKey -o tsv \| gh secret set/);
  });
  it('never prints a secret', () => {
    for (const line of script.split('\n').filter((l) => /^\s*(echo|printf|say)\b/.test(l))) {
      expect(line).not.toMatch(/\$(TOKEN|PEPPER|EXISTING_TOKEN|EXISTING_PEPPER)\b/);
    }
  });
});

// @req FR:live-deploy/setup.doc
describe('setup doc', () => {
  it('lists the human-only steps with exact clicks and the least-privilege token', () => {
    expect(doc).toMatch(/personal-access-tokens\/new\?[^)]*contents=write/);
    expect(doc).toMatch(/Only select repositories/);
    expect(doc).toMatch(/scripts\/setup-azure\.sh/);
    expect(doc).toMatch(/Install this site as an app/);
    expect(doc).toMatch(/## Undo or rotate/);
  });
});
