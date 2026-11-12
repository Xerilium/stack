#Requires -Version 7.0
<#
.SYNOPSIS
  One-time setup: registers the Stack sign-in app in Entra ID and saves its client id for Stack.

.DESCRIPTION
  Creates (or reuses) one multi-tenant public client app named "Stack (Xerilium)" that personal Microsoft accounts
  (Outlook.com) and work or school accounts can sign in to. Delegated Microsoft Graph permissions only:
  Mail.Read, Calendars.Read, Mail.ReadWrite (asked for only when you turn on reply drafts), offline_access, openid, profile.
  Never Mail.Send, never an application permission, never a secret.

  Writes graph.clientId to ~/.config/stack/config.json (keeps every other key). Prints the client id (not a secret).

  Needs Az PowerShell (Az.Accounts, Az.Resources) and an Azure sign-in. This script never takes a credential:
  run Connect-AzAccount yourself first. Without a sign-in it exits with code 3.

  Safe to run again: it changes only what is not right yet.

.PARAMETER ConfigPath
  The Stack user config. Default ~/.config/stack/config.json.

.NOTES
  @req FR:connect-accounts/setup.script
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [string] $ConfigPath = (Join-Path $HOME '.config/stack/config.json')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$DisplayName = 'Stack (Xerilium)'
$RedirectUri = 'http://localhost'
$GraphAppId = '00000003-0000-0000-c000-000000000000'
# Delegated Microsoft Graph permission ids (Scope). No send, no write beyond drafts, no application roles.
$Scopes = [ordered]@{
  'Mail.Read'       = 'e383f46e-2787-4529-855e-0e479a3ffac0'
  'Calendars.Read'  = '465a38f9-76ea-45b9-9f34-9e8b0d4b0b42'
  'Mail.ReadWrite'  = '024d486e-b451-40bb-833d-3e66d98c5c73'
  'offline_access'  = '7427e0e9-2fba-42fe-b0c0-848c9e6a8182'
  'openid'          = '37f7f235-527c-4136-accd-4a02d197296e'
  'profile'         = '14dad69e-099b-42c9-810b-d002981feec1'
}

foreach ($m in 'Az.Accounts', 'Az.Resources') {
  if (-not (Get-Module -ListAvailable -Name $m)) {
    Write-Host "Az PowerShell is not installed. Run: Install-Module Az -Scope CurrentUser"
    exit 4
  }
}
Import-Module Az.Accounts, Az.Resources -ErrorAction Stop | Out-Null

if (-not (Get-AzContext -ErrorAction SilentlyContinue)) {
  Write-Host 'Sign in to Azure once: run Connect-AzAccount, then run setup again.'
  exit 3
}

$access = @{
  ResourceAppId  = $GraphAppId
  ResourceAccess = @($Scopes.Values | ForEach-Object { @{ Id = $_; Type = 'Scope' } })
}

$app = @(Get-AzADApplication -DisplayName $DisplayName -ErrorAction SilentlyContinue) | Select-Object -First 1
if (-not $app) {
  if ($PSCmdlet.ShouldProcess($DisplayName, 'Create app registration')) {
    $app = New-AzADApplication -DisplayName $DisplayName `
      -SignInAudience 'AzureADandPersonalMicrosoftAccount' `
      -RequestedAccessTokenVersion 2 `
      -IsFallbackPublicClient `
      -PublicClientRedirectUri $RedirectUri `
      -RequiredResourceAccess $access
  }
}
elseif ($PSCmdlet.ShouldProcess($DisplayName, 'Update app registration')) {
  # Make an existing app match: same audience, public client, loopback redirect, the same delegated permissions only.
  Update-AzADApplication -ObjectId $app.Id `
    -RequestedAccessTokenVersion 2 `
    -SignInAudience 'AzureADandPersonalMicrosoftAccount' `
    -IsFallbackPublicClient `
    -PublicClientRedirectUri $RedirectUri `
    -RequiredResourceAccess $access
  $app = Get-AzADApplication -ObjectId $app.Id
}

if (-not $app) { exit 0 } # -WhatIf

# No secret: a public client never has one. Refuse to go on if someone added one.
if (@($app.PasswordCredentials).Count -gt 0) {
  Write-Host "The app '$DisplayName' has a client secret. Remove it in Entra ID, then run setup again."
  exit 5
}

$clientId = [string] $app.AppId
if ($clientId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') {
  Write-Host 'The app registration has no valid client id.'
  exit 1
}

# Merge graph.clientId into the user config; keep every other key.
$cfg = [ordered]@{}
if (Test-Path $ConfigPath) {
  $raw = Get-Content -Raw -Path $ConfigPath
  if ($raw.Trim()) { $cfg = $raw | ConvertFrom-Json -AsHashtable }
}
if (-not $cfg.Contains('graph') -or $cfg['graph'] -isnot [System.Collections.IDictionary]) { $cfg['graph'] = [ordered]@{} }
if ($cfg['graph']['clientId'] -ne $clientId -and $PSCmdlet.ShouldProcess($ConfigPath, 'Save graph.clientId')) {
  $cfg['graph']['clientId'] = $clientId
  $dir = Split-Path -Parent $ConfigPath
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $tmp = "$ConfigPath.$PID.tmp"
  $cfg | ConvertTo-Json -Depth 10 | Set-Content -Path $tmp -NoNewline
  if (-not $IsWindows) { chmod 600 $tmp }
  Move-Item -Path $tmp -Destination $ConfigPath -Force
}

Write-Output $clientId
exit 0
