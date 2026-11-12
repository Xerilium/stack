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
  [ValidatePattern('^(?!.*\.\.)(?!.*//)(?!.*/\.)(?!.*\.lock(/|$))[A-Za-z0-9_][A-Za-z0-9._/-]{0,199}(?<![/.])$')] [string]$Branch = 'stack/live',
  [ValidatePattern('^$|^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$')] [string]$Domain = 'stack.xerilium.com',
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
function Merge-StackSettings([hashtable]$Current, [hashtable]$Changes) {
  $out = @{}
  foreach ($k in $Current.Keys) { $out[$k] = $Current[$k] }
  foreach ($k in $Changes.Keys) { if ($Changes[$k]) { $out[$k] = $Changes[$k] } }
  return $out
}

# First-run template parameters, in memory only (never a file).
function New-StackDeployParams([string]$Name, [string]$Location, [string]$Owners, [string]$Pepper, [string]$RepoUrl, [string]$RepoToken, [string]$Branch, [string]$Domain) {
  return @{ name = $Name; location = $Location; owners = $Owners; tokenPepper = $Pepper; repoUrl = $RepoUrl; repoToken = $RepoToken; repoBranch = $Branch; customDomain = $Domain }
}

# Dot-sourced (tests): functions only.
if ($MyInvocation.InvocationName -eq '.') { return }

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
$exists = $false
if (Get-AzResourceGroup -Name $Group -ErrorAction SilentlyContinue) {
  $exists = [bool](@(Get-AzStaticWebApp -ResourceGroupName $Group) | Where-Object Name -EQ $Name)
}

# -Owner on an existing site: only update the allow-list (takes effect at once, no redeploy).
# @req FR:live-deploy/setup.owner
$onlyOwner = [bool]$Owner -and $exists

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
    $env:GH_TOKEN = $plain # child-process environment only; never printed or saved
    try {
      $default = & gh api "repos/$Repo" -q .default_branch 2>$null
      if ($LASTEXITCODE -ne 0 -or -not $default) { throw "That token cannot see $Repo. Check its repository access." }
      & gh api "repos/$Repo/git/ref/heads/$Branch" -q .object.sha *> $null
      if ($LASTEXITCODE -ne 0) {
        $base = & gh api "repos/$Repo/git/ref/heads/$default" -q .object.sha 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $base) { throw "That token cannot read $Repo contents. Give it Contents: Read and write." }
        Say "Creating branch $Branch from $default"
        & gh api "repos/$Repo/git/refs" -f "ref=refs/heads/$Branch" -f "sha=$base" *> $null
        if ($LASTEXITCODE -ne 0) { throw "Could not create $Branch. Give the token Contents: Read and write." }
      }
    } finally { Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue }
  } elseif (-not $exists) {
    throw 'No token given. See docs/setup-live.md step 1.'
  }
}

if (-not $exists) {
  Say "Resource group $Group ($Location)"
  New-AzResourceGroup -Name $Group -Location $Location -Force | Out-Null
  # First run only: the template writes the whole settings list, so it never runs against a live site.
  # The custom domain is added after, once its CNAME can point at the new hostname.
  $pepper = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
  $params = New-StackDeployParams -Name $Name -Location $Location -Owners $Owner -Pepper $pepper -RepoUrl "https://github.com/$Repo" -RepoToken $plain -Branch $Branch -Domain ''
  Say "Static Web App $Name (Free)"
  New-AzResourceGroupDeployment -ResourceGroupName $Group -Name stack-setup -TemplateFile (Join-Path $root 'infra/main.bicep') -TemplateParameterObject $params | Out-Null
  $params = $null; $pepper = $null
}
$site = Get-AzStaticWebApp -ResourceGroupName $Group -Name $Name
if ($exists) {
  Say "Updating settings on $Name (other settings are kept)"
  $res = Invoke-AzRestMethod -Method POST -Path "$($site.Id)/listAppSettings?$api"
  if ($res.StatusCode -ge 300) { throw "Could not read app settings ($($res.StatusCode))." }
  $current = @{}
  $props = ($res.Content | ConvertFrom-Json -AsHashtable).properties
  if ($props) { $current = $props }
  # Repo and branch change only when given, so a re-run never silently repoints a site.
  # @req FR:deploy-stack-xerilium-com/branch.rerun
  $changes = @{ STACK_OWNERS = $Owner; STACK_REPO_TOKEN = $plain }
  if ($PSBoundParameters.ContainsKey('Repo')) { $changes.STACK_REPO_URL = "https://github.com/$Repo" }
  if ($PSBoundParameters.ContainsKey('Branch')) { $changes.STACK_REPO_BRANCH = $Branch }
  $body = @{ properties = (Merge-StackSettings -Current $current -Changes $changes) } | ConvertTo-Json -Compress
  $res = Invoke-AzRestMethod -Method PUT -Path "$($site.Id)/config/appsettings?$api" -Payload $body
  $body = $null
  if ($res.StatusCode -ge 300) { throw "Could not write app settings ($($res.StatusCode))." }
}
$plain = $null
$hostName = $site.DefaultHostname

if ($onlyOwner) {
  Say 'Done'
  Write-Host "Owner set. Reload https://$(if ($Domain) { $Domain } else { $hostName })"
  exit 0
}

# @req FR:deploy-stack-xerilium-com/domain.script
if ($Domain) {
  $label, $zone = $Domain.Split('.', 2)
  Say "Custom domain $Domain"
  Write-Host "DNS record at the $zone DNS host: CNAME  $label  ->  $hostName"
  $have = @(Get-AzStaticWebAppCustomDomain -ResourceGroupName $Group -Name $Name) | Where-Object Name -EQ $Domain
  if ($have) {
    Write-Host "$Domain is on the site."
  } else {
    try {
      New-AzStaticWebAppCustomDomain -ResourceGroupName $Group -Name $Name -DomainName $Domain -ValidationMethod cname-delegation | Out-Null
      Write-Host "$Domain added. The free certificate can take up to an hour."
    } catch {
      Write-Warning "Could not add $Domain yet. Add the CNAME above, wait for DNS, then re-run (Enter keeps the token)."
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
Write-Host "Watch it: gh run watch -R $App `$(gh run list -R $App -w Deploy -L 1 --json databaseId -q '.[0].databaseId')"

Say 'Done'
Write-Host "When the run is green, open https://$hostName in Edge and sign in with GitHub."
if (-not $Owner) { Write-Host "First sign-in shows 'Not on the allow-list' with a command to copy. Run it once; that makes you the owner." }
