import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const path = join(root, 'scripts/setup-azure.ps1');
const script = existsSync(path) ? readFileSync(path, 'utf8') : '';
const doc = readFileSync(join(root, 'docs/setup-live.md'), 'utf8');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0;
const itPwsh = hasPwsh ? it : it.skip;
/** Runs PowerShell with the script dot-sourced (functions only, main body skipped). */
const ps = (code: string) => execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `. '${path}'; ${code}`], { encoding: 'utf8', env: { PATH: process.env.PATH!, HOME: process.env.HOME! } });
/** Code lines only (no comments). */
const code = script.split('\n').filter((l) => !/^\s*#/.test(l));

// @req FR:deploy-stack-xerilium-com/setup.ps @req FR:live-deploy/setup.script
describe('setup-azure.ps1', () => {
  it('exists and the bash script is gone', () => {
    expect(script.length).toBeGreaterThan(0);
    expect(existsSync(join(root, 'scripts/setup-azure.sh'))).toBe(false);
    expect(script).toMatch(/^Set-StrictMode -Version Latest$/m);
    expect(script).toMatch(/^\$ErrorActionPreference = 'Stop'$/m);
  });
  // @req FR:deploy-stack-xerilium-com/setup.ps
  it('never calls the az CLI', () => {
    for (const l of code) expect(l).not.toMatch(/(^|[|;({]\s*|&\s*)az\s/);
  });
  // @req FR:deploy-stack-xerilium-com/setup.sub
  it('selects the subscription it is given, else prompts; never the default context', () => {
    expect(script).toMatch(/\[string\]\$Subscription = ''/);
    expect(script).toMatch(/Set-AzContext -Subscription \$Subscription/);
    expect(script).toMatch(/Get-AzSubscription/);
    expect(script).toMatch(/Read-Host 'Subscription/);
  });
  // @req FR:live-deploy/setup.script.rerun
  it('applies the bicep template only when the site does not exist yet', () => {
    const deploy = script.indexOf('New-AzResourceGroupDeployment');
    const guard = script.lastIndexOf('if (-not $exists) {', deploy);
    expect(deploy).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(0);
    expect(script).toMatch(/-TemplateFile \(Join-Path \$root 'infra\/main\.bicep'\)/);
  });
  it('sets the deploy secret and starts the deploy', () => {
    expect(script).toMatch(/Invoke-AzRestMethod -Method POST -Path "\$\(\$site\.Id\)\/listSecrets/);
    expect(script).toMatch(/\| gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN -R \$App/);
    expect(script).toMatch(/gh workflow run deploy\.yml -R \$App --ref main/);
  });
  // @req FR:deploy-stack-xerilium-com/setup.args @req FR:live-deploy/setup.script.args
  it('validates every parameter at bind time', () => {
    for (const p of ['Repo', 'Branch', 'Group', 'Name', 'Location', 'App', 'Owner', 'Domain', 'Subscription']) expect(script).toMatch(new RegExp(`\\[Validate(Pattern|Set)\\([^\\n]*\\)\\]\\s*\\[string\\]\\$${p}\\b`));
  });
  // @req FR:deploy-stack-xerilium-com/setup.args
  itPwsh('rejects a bad argument before any Azure call', () => {
    for (const args of [['-Repo', 'not a repo'], ['-Branch', '--upload-pack=x'], ['-Owner', 'github:a b'], ['-Domain', 'http://x'], ['-Domain', 'xerilium.com']]) {
      const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', path, ...args], { encoding: 'utf8' });
      expect(r.status).not.toBe(0);
      expect(r.stdout + r.stderr).toMatch(/Cannot validate argument/);
      expect(r.stdout + r.stderr).not.toMatch(/Connect-AzAccount|Subscription:/);
    }
  });
  // @req FR:deploy-stack-xerilium-com/setup.merge @req FR:live-deploy/setup.script.rerun
  itPwsh('re-run merges only the changed settings and keeps the rest', () => {
    const out = ps(`$c = @{ STACK_OWNERS = ''; STACK_SLACK_SIGNING_SECRET = 'keep'; STACK_REPO_TOKEN = 'old'; STACK_TOKEN_PEPPER = 'pep' }; Merge-StackSettings -Current $c -Changes @{ STACK_OWNERS = 'github:abc'; STACK_REPO_URL = ''; STACK_REPO_TOKEN = '' } | ConvertTo-Json -Compress`);
    expect(JSON.parse(out)).toEqual({ STACK_OWNERS: 'github:abc', STACK_SLACK_SIGNING_SECRET: 'keep', STACK_REPO_TOKEN: 'old', STACK_TOKEN_PEPPER: 'pep' });
  });
  // @req FR:deploy-stack-xerilium-com/branch.rerun
  itPwsh('re-run fills a missing branch, repo URL, or pepper and never overwrites a set one', () => {
    const out = ps(`$c = @{ STACK_REPO_URL = 'https://github.com/a/b' }; Merge-StackSettings -Current $c -Changes @{} -Defaults @{ STACK_REPO_BRANCH = 'stack/live'; STACK_REPO_URL = 'https://github.com/x/y'; STACK_TOKEN_PEPPER = 'p' } | ConvertTo-Json -Compress`);
    expect(JSON.parse(out)).toEqual({ STACK_REPO_URL: 'https://github.com/a/b', STACK_REPO_BRANCH: 'stack/live', STACK_TOKEN_PEPPER: 'p' });
  });
  it('treats only a missing group or site as new; any other Azure error stops the script', () => {
    expect(script).not.toMatch(/Get-AzResourceGroup[^\n]*SilentlyContinue/);
    expect(script).not.toMatch(/Get-AzStaticWebApp[^\n]*SilentlyContinue/);
  });
  it('checks the branch exists even when the token is kept, and that the deploy started', () => {
    expect(script).toMatch(/Test-StackBranch/);
    expect(script).toMatch(/gh workflow run deploy\.yml[^\n]*\n\s*if \(\$LASTEXITCODE -ne 0\)/);
  });
  it('refuses -Debug, which would log secrets', () => {
    expect(script).toMatch(/\$DebugPreference -ne 'SilentlyContinue'/);
  });
  // @req FR:deploy-stack-xerilium-com/setup.merge
  itPwsh('builds the first-run parameters with every bicep parameter', () => {
    const out = ps(`New-StackDeployParams -Name n -Location westus2 -Owners '' -Pepper p -RepoUrl https://github.com/a/b -RepoToken 'a"b\\c' -Branch stack/live -Domain '' | ConvertTo-Json -Compress`);
    const p = JSON.parse(out);
    expect(p.repoToken).toBe('a"b\\c');
    expect(p.repoBranch).toBe('stack/live');
    expect(Object.keys(p).sort()).toEqual(['customDomain', 'location', 'name', 'owners', 'repoBranch', 'repoToken', 'repoUrl', 'tokenPepper']);
  });
});

// @req FR:deploy-stack-xerilium-com/setup.secrets @req FR:live-deploy/setup.secrets
describe('setup secrets', () => {
  it('reads the token hidden and pipes the deploy key on stdin', () => {
    expect(script).toMatch(/Read-Host -AsSecureString/);
    expect(script).toMatch(/\$env:STACK_REPO_TOKEN/);
    expect(script).toMatch(/TemplateParameterObject/);
    expect(script).not.toMatch(/Out-File|Set-Content|TemplateParameterFile/);
  });
  // @req FR:live-deploy/setup.secrets.quiet
  it('never prints a secret or puts one on a command line', () => {
    for (const l of code.filter((x) => /\b(Write-Host|Write-Output|Say)\b/.test(x))) expect(l).not.toMatch(/\$(token|pepper|plain)\b/i);
    for (const l of code.filter((x) => /^\s*(gh|& gh)\s/.test(x))) expect(l).not.toMatch(/\$(token|pepper|plain)\b/i);
  });
  it('clears the token from the child environment when done', () => {
    expect(script).toMatch(/Remove-Item Env:GH_TOKEN/);
  });
});

// @req FR:deploy-stack-xerilium-com/branch.default @req FR:deploy-stack-xerilium-com/branch.create @req FR:deploy-stack-xerilium-com/branch.rerun
describe('live branch', () => {
  it('defaults to stack/live and creates it from the default branch when missing', () => {
    expect(script).toMatch(/\[string\]\$Branch = 'stack\/live'/);
    expect(script).toMatch(/gh api "repos\/\$Repo\/git\/refs" -f "ref=refs\/heads\/\$Branch" -f "sha=\$base"/);
    expect(script).toMatch(/default_branch/);
  });
  it('a re-run changes the branch and repo only when given', () => {
    expect(script).toMatch(/\$PSBoundParameters\.ContainsKey\('Branch'\)/);
    expect(script).toMatch(/\$PSBoundParameters\.ContainsKey\('Repo'\)/);
  });
});

// @req FR:deploy-stack-xerilium-com/domain.script
describe('custom domain', () => {
  it('prints the CNAME and adds the domain only when missing, without stopping the rest', () => {
    expect(script).toMatch(/\[string\]\$Domain = 'stack\.xerilium\.com'/);
    expect(script).toMatch(/CNAME/);
    expect(script).toMatch(/Get-AzStaticWebAppCustomDomain/);
    expect(script).toMatch(/New-AzStaticWebAppCustomDomain[^\n]*-ValidationMethod cname-delegation/);
    expect(script).toMatch(/catch \{[^}]*re-run/s);
    expect(script).toMatch(/Exception\.Message/);
    expect(script).toMatch(/Status -ne 'Ready'|Status -eq 'Ready'/);
  });
});

// @req FR:live-deploy/setup.owner
describe('owner claim', () => {
  it('-Owner on an existing site only updates the allow-list', () => {
    expect(script).toMatch(/\$onlyOwner = \[bool\]\$Owner -and \$exists/);
    const only = script.indexOf('if ($onlyOwner) {\n  Say \'Done\'');
    expect(only).toBeGreaterThan(0);
    expect(script.indexOf('gh secret set')).toBeGreaterThan(only);
  });
});

// @req FR:live-deploy/setup.doc @req FR:deploy-stack-xerilium-com/domain.doc @req FR:deploy-stack-xerilium-com/branch.doc
describe('setup doc', () => {
  it('lists the human-only steps with exact clicks and the least-privilege token', () => {
    expect(doc).toMatch(/personal-access-tokens\/new\?[^)]*contents=write/);
    expect(doc).toMatch(/Only select repositories/);
    expect(doc).toMatch(/scripts\/setup-azure\.ps1/);
    expect(doc).not.toMatch(/setup-azure\.sh|az login/);
    expect(doc).toMatch(/-Owner github:/);
    expect(doc).toMatch(/Install this site as an app/);
    expect(doc).toMatch(/## Undo or rotate/);
  });
  it('gives the exact DNS record and names the live branch', () => {
    expect(doc).toMatch(/CNAME/);
    expect(doc).toMatch(/`stack`/);
    expect(doc).toMatch(/azurestaticapps\.net/);
    expect(doc).toMatch(/stack\/live/);
  });
});

// @req FR:deploy-stack-xerilium-com/auth.doc @req FR:deploy-stack-xerilium-com/hybrid.design
describe('deploy docs', () => {
  const lines = (p: string) => readFileSync(join(root, p), 'utf8').trimEnd().split('\n').length;
  it('keeps the auth answer and hybrid design short', () => {
    expect(lines('docs/deploy-auth.md')).toBeLessThanOrEqual(30);
    expect(lines('docs/hybrid-state.md')).toBeLessThanOrEqual(25);
  });
  it('auth answer covers what exists, what is not covered, and gaps', () => {
    const d = readFileSync(join(root, 'docs/deploy-auth.md'), 'utf8');
    for (const s of ['STACK_OWNERS', 'Bearer', 'device', 'Not covered', 'Gaps', 'Strict-Transport-Security']) expect(d).toContain(s);
  });
});
