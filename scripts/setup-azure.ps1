#!/usr/bin/env pwsh
# @req FR:deploy-stack-xerilium-com/setup.ps @req FR:live-deploy/setup.script @req FR:live-deploy/setup.secrets @req FR:live-deploy/setup.owner
# Hosting setup for Stack on Azure Static Web Apps (Free). Run it yourself; agents never do. Safe to re-run.
# Needs: PowerShell 7, Az PowerShell (Az.Accounts, Az.Resources, Az.Websites; sign in with Connect-AzAccount), bicep,
# gh (signed in: gh auth login), and a fine-grained GitHub token for the task repo (Contents: read and write, that repo only).
# See docs/setup-live.md.
#
# Usage: scripts/setup-azure.ps1 [-Subscription <name or id>] [-Repo flanakin/todo] [-Branch stack/live] [-Domain stack.xerilium.com]
#                                [-Group stack-rg] [-Name stack-app] [-Location westus2] [-App Xerilium/stack]
#        scripts/setup-azure.ps1 -Owner github:<id shown on the "Not on the allow-list" page>
# No -Subscription: lists your subscriptions and asks. The current Az context is never used as is.
# The task repo token is read from a hidden prompt, or from STACK_REPO_TOKEN. On a re-run, Enter keeps the current one.
# @req FR:deploy-stack-xerilium-com/setup.args @req FR:live-deploy/setup.script.args
[CmdletBinding()]
param(
  [ValidatePattern('^$|^[A-Za-z0-9 ._()-]{1,64}$')] [string]$Subscription = '',
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9._-]+$')] [string]$Repo = 'flanakin/todo',
  [ValidatePattern('^(?!(main|master)$)(?!.*\.\.)(?!.*//)(?!.*/\.)(?!.*\.lock(/|$))[A-Za-z0-9_][A-Za-z0-9._/-]{0,199}(?<![/.])$')] [string]$Branch = 'stack/live',
  [ValidatePattern('^$|^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.){2,}[a-z]{2,63}$')] [string]$Domain = 'stack.xerilium.com',
  [ValidatePattern('^[A-Za-z0-9._()-]{1,90}$')] [string]$Group = 'stack-rg',
  [ValidatePattern('^[A-Za-z0-9-]{1,40}$')] [string]$Name = 'stack-app',
  [ValidateSet('westus2', 'centralus', 'eastus2', 'westeurope', 'eastasia')] [string]$Location = 'westus2',
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9._-]+$')] [string]$App = 'Xerilium/stack',
  [ValidatePattern('^$|^github:[A-Za-z0-9-]{1,128}$')] [string]$Owner = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$api = 'api-version=2023-12-01'

function Say([string]$Text) { Write-Host "`n== $Text" }

# @req FR:deploy-stack-xerilium-com/setup.merge @req FR:live-deploy/setup.script.rerun
# Merges non-empty changes into the current app settings; every other setting is kept.
# Defaults fill only missing or empty settings, so an older site gains the live branch and a pepper.
function Merge-StackSettings([hashtable]$Current, [hashtable]$Changes, [hashtable]$Defaults = @{}) {
  $out = @{}
  foreach ($k in $Current.Keys) { $out[$k] = $Current[$k] }
  foreach ($k in $Defaults.Keys) { if (-not $out[$k] -and $Defaults[$k]) { $out[$k] = $Defaults[$k] } }
  foreach ($k in $Changes.Keys) { if ($Changes[$k]) { $out[$k] = $Changes[$k] } }
  return $out
}

# True when the branch exists. Uses GH_TOKEN when set (the repo token), else your own gh sign-in.
function Test-StackBranch([string]$Repo, [string]$Branch) {
  & gh api "repos/$Repo/git/ref/heads/$Branch" -q .object.sha *> $null
  return $LASTEXITCODE -eq 0
}

function New-StackPepper { [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant() }

# First-run template parameters, in memory only (never a file).
function New-StackDeployParams([string]$Name, [string]$Location, [string]$Owners, [string]$Pepper, [string]$RepoUrl, [string]$RepoToken, [string]$Branch, [string]$Domain) {
  return @{ name = $Name; location = $Location; owners = $Owners; tokenPepper = $Pepper; repoUrl = $RepoUrl; repoToken = $RepoToken; repoBranch = $Branch; customDomain = $Domain }
}

# Dot-sourced (tests): functions only.
if ($MyInvocation.InvocationName -eq '.') { return }

# -Owner only claims an existing site; it never repoints one.
if ($Owner -and ($PSBoundParameters.ContainsKey('Repo') -or $PSBoundParameters.ContainsKey('Branch'))) { throw '-Owner cannot be combined with -Repo or -Branch. Run them separately.' }
# -Debug and -Verbose log request bodies, which hold the repo token, the pepper, and the deploy key.
if ($DebugPreference -ne 'SilentlyContinue' -or $VerbosePreference -ne 'SilentlyContinue') { throw 'Run without -Debug or -Verbose: they log secrets.' }
$root = Split-Path -Parent $PSScriptRoot
foreach ($cmd in 'gh', 'bicep') { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "Missing $cmd. Install it and re-run." } }
foreach ($m in 'Az.Accounts', 'Az.Resources', 'Az.Websites') { if (-not (Get-Module -ListAvailable $m)) { throw "Missing $m. Run: Install-Module Az -Scope CurrentUser" } }
if (-not (Get-AzContext)) { throw "Run 'Connect-AzAccount' first." }
& gh auth status *> $null
if ($LASTEXITCODE -ne 0) { throw "Run 'gh auth login' first." }

# @req FR:deploy-stack-xerilium-com/setup.sub
if (-not $Subscription) {
  $subs = @(Get-AzSubscription | Sort-Object Name)
  for ($i = 0; $i -lt $subs.Count; $i++) { Write-Host ("{0,3}. {1}  ({2})" -f ($i + 1), $subs[$i].Name, $subs[$i].Id) }
  $pick = Read-Host 'Subscription for Stack (number, name, or id)'
  $Subscription = if ($pick -match '^\d{1,3}$' -and [int]$pick -ge 1 -and [int]$pick -le $subs.Count) { $subs[[int]$pick - 1].Id } else { $pick }
  if (-not $Subscription) { throw 'No subscription chosen.' }
}
$ctx = Set-AzContext -Subscription $Subscription
Say "Subscription: $($ctx.Subscription.Name)"

# Only "not there" means a new site; any other failure stops the script.
# @req FR:live-deploy/setup.script.rerun
# A listing, not a lookup by name: "not there" is an empty result and every real error throws.
$exists = $false
if (@(Get-AzResourceGroup) | Where-Object ResourceGroupName -EQ $Group) {
  $exists = [bool](@(Get-AzStaticWebApp -ResourceGroupName $Group) | Where-Object Name -EQ $Name)
}

# -Owner on an existing site: only update the allow-list (takes effect at once, no redeploy).
# @req FR:live-deploy/setup.owner
$onlyOwner = [bool]$Owner -and $exists

# A re-run checks and keeps the repo and branch the site already uses, unless -Repo or -Branch is given.
# A site still on main (or with no branch) moves to -Branch (default stack/live).
$current = @{}
if ($exists) {
  $site = Get-AzStaticWebApp -ResourceGroupName $Group -Name $Name
  $res = Invoke-AzRestMethod -Method POST -Path "$($site.Id)/listAppSettings?$api"
  if ($res.StatusCode -ge 300) { throw "Could not read app settings ($($res.StatusCode))." }
  $props = ($res.Content | ConvertFrom-Json -AsHashtable).properties
  if ($props) { $current = $props }
  $res = $null; $props = $null
  if (-not $PSBoundParameters.ContainsKey('Repo') -and "$($current['STACK_REPO_URL'])" -match '^https://github\.com/([A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9._-]+?)(\.git)?$') { $Repo = $Matches[1] }
  $curBranch = "$($current['STACK_REPO_BRANCH'])"
  if (-not $PSBoundParameters.ContainsKey('Branch') -and $curBranch -and $curBranch -notin 'main', 'master') { $Branch = $curBranch }
}

# @req FR:deploy-stack-xerilium-com/setup.secrets
$plain = ''
if (-not $onlyOwner) {
  $plain = "$env:STACK_REPO_TOKEN"
  if (-not $plain) {
    $prompt = if ($exists) { "Task repo token for $Repo (Enter keeps the current one)" } else { "Task repo token for $Repo (fine-grained, Contents read and write)" }
    $plain = ConvertFrom-SecureString -SecureString (Read-Host -AsSecureString -Prompt $prompt) -AsPlainText
  }
  if ($plain) {
    if ($plain -notmatch '^[A-Za-z0-9_]+$') { throw 'That does not look like a GitHub token (letters, digits, _).' }
    # @req FR:deploy-stack-xerilium-com/branch.create
    Say "Checking the token can read $Repo and branch $Branch"
    $prevGh = $env:GH_TOKEN
    $env:GH_TOKEN = $plain # child-process environment only; never printed or saved
    try {
      $default = & gh api "repos/$Repo" -q .default_branch 2>$null
      if ($LASTEXITCODE -ne 0 -or -not $default) { throw "That token cannot see $Repo. Check its repository access." }
      if ($Branch -eq $default) { throw "Branch $Branch is the default branch of $Repo. Live data must stay off it; pick another -Branch." }
      if (-not (Test-StackBranch $Repo $Branch)) {
        $base = & gh api "repos/$Repo/git/ref/heads/$default" -q .object.sha 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $base) { throw "That token cannot read $Repo contents. Give it Contents: Read and write." }
        Say "Creating branch $Branch from $default"
        & gh api "repos/$Repo/git/refs" -f "ref=refs/heads/$Branch" -f "sha=$base" *> $null
        if ($LASTEXITCODE -ne 0) { throw "Could not create $Branch. Give the token Contents: Read and write." }
      }
    } finally { if ($prevGh) { $env:GH_TOKEN = $prevGh } else { Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue } }
  } elseif (-not $exists) {
    throw 'No token given. See docs/setup-live.md step 1.'
  } elseif (-not (Test-StackBranch $Repo $Branch)) {
    # Token kept: check with your own gh sign-in, so the site never points at a missing branch.
    throw "Branch $Branch is missing on $Repo. Re-run and paste the repo token to create it."
  }
}

if (-not $exists) {
  Say "Resource group $Group ($Location)"
  New-AzResourceGroup -Name $Group -Location $Location -Force | Out-Null
  # First run only: the template writes the whole settings list, so it never runs against a live site.
  # The custom domain is added after, once its CNAME can point at the new hostname.
  $pepper = New-StackPepper
  $params = New-StackDeployParams -Name $Name -Location $Location -Owners $Owner -Pepper $pepper -RepoUrl "https://github.com/$Repo" -RepoToken $plain -Branch $Branch -Domain ''
  Say "Static Web App $Name (Free)"
  New-AzResourceGroupDeployment -ResourceGroupName $Group -Name stack-setup -TemplateFile (Join-Path $root 'infra/main.bicep') -TemplateParameterObject $params | Out-Null
  $params = $null; $pepper = $null
}
$site = Get-AzStaticWebApp -ResourceGroupName $Group -Name $Name
if ($exists) {
  Say "Updating settings on $Name (other settings are kept)"
  # Repo and branch are the site's own unless -Repo or -Branch was given (resolved above), so a re-run never silently repoints a site.
  # @req FR:deploy-stack-xerilium-com/branch.rerun
  $changes = @{ STACK_OWNERS = $Owner; STACK_REPO_TOKEN = $plain }
  if ($PSBoundParameters.ContainsKey('Repo')) { $changes.STACK_REPO_URL = "https://github.com/$Repo" }
  if (-not $onlyOwner) { $changes.STACK_REPO_BRANCH = $Branch }
  # An older site gains a repo URL and a pepper when missing; values already set are kept.
  $defaults = @{ STACK_REPO_URL = "https://github.com/$Repo"; STACK_TOKEN_PEPPER = (New-StackPepper) }
  $body = @{ properties = (Merge-StackSettings -Current $current -Changes $changes -Defaults $defaults) } | ConvertTo-Json -Compress
  $res = Invoke-AzRestMethod -Method PUT -Path "$($site.Id)/config/appsettings?$api" -Payload $body
  $body = $null
  if ($res.StatusCode -ge 300) { throw "Could not write app settings ($($res.StatusCode))." }
}
$plain = $null
$hostName = $site.DefaultHostname
# The domain counts only once Azure says it is Ready.
$have = if ($Domain) { @(Get-AzStaticWebAppCustomDomain -ResourceGroupName $Group -Name $Name) | Where-Object Name -EQ $Domain | Select-Object -First 1 } else { $null }
$ready = [bool]$have -and $have.Status -eq 'Ready'
$url = if ($ready) { "https://$Domain" } else { "https://$hostName" }

if ($onlyOwner) {
  Say 'Done'
  Write-Host "Owner set. Reload $url"
  exit 0
}

# @req FR:deploy-stack-xerilium-com/domain.script
if ($Domain) {
  $label, $zone = $Domain.Split('.', 2)
  Say "Custom domain $Domain"
  Write-Host "DNS record at the $zone DNS host: CNAME  $label  ->  $hostName"
  if ($ready) {
    Write-Host "$Domain is ready."
  } elseif (-not $exists) {
    # New site: the CNAME cannot point at it yet.
    Write-Host "Add that record, wait until 'dig +short $Domain' shows $hostName, then re-run (Enter keeps the token)."
  } elseif ($have -and $have.Status -ne 'Failed') {
    Write-Host "$Domain is $($have.Status). The free certificate can take up to an hour; re-run to check."
  } else {
    try {
      if ($have) { Remove-AzStaticWebAppCustomDomain -ResourceGroupName $Group -Name $Name -DomainName $Domain | Out-Null }
      New-AzStaticWebAppCustomDomain -ResourceGroupName $Group -Name $Name -DomainName $Domain -ValidationMethod cname-delegation | Out-Null
      Write-Host "$Domain added. The free certificate can take up to an hour."
    } catch {
      Write-Warning "Could not add $Domain yet: $($_.Exception.Message) Add the CNAME above, wait for DNS, then re-run (Enter keeps the token)."
    }
  }
}

Say "Deploy secret on $App"
$keys = Invoke-AzRestMethod -Method POST -Path "$($site.Id)/listSecrets?$api"
if ($keys.StatusCode -ge 300) { throw "Could not read the deploy secret ($($keys.StatusCode))." }
($keys.Content | ConvertFrom-Json).properties.apiKey | gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN -R $App
if ($LASTEXITCODE -ne 0) { throw 'Could not set the deploy secret.' }
$keys = $null

Say 'Deploying (GitHub Actions: Deploy)'
gh workflow run deploy.yml -R $App --ref main
if ($LASTEXITCODE -ne 0) { throw 'Could not start the Deploy workflow. Start it in GitHub Actions.' }
Write-Host "Watch it: gh run watch -R $App (pick the newest Deploy run)"

Say 'Done'
Write-Host "When the run is green, open $url in Edge and sign in with GitHub."
if (-not $Owner) { Write-Host "First sign-in shows 'Not on the allow-list' with a command to copy. Run it once; that makes you the owner." }
