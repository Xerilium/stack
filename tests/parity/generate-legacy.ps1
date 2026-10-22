<#
Generates the expected summary files from the LEGACY PowerShell implementation.

Usage (run against a scratch COPY of the legacy repo; never the live legacy repo):
  TZ=America/Los_Angeles pwsh generate-legacy.ps1 -LegacyRoot <copy-of-legacy-repo> -CaseDir <case dir>

Case dir layout (spec: .xe/features/summaries/spec.md, Legacy Parity):
  now.txt, now-<label>.txt     instants to freeze the clock at, ISO 8601 with offset (at least one); each writes expected/ or expected/<label>/
  tasks/*.md                   project files
  .xe/config/stack.json        optional config (legacy reads it from the working directory)
  prior/README.md              optional README from the previous run (footer is preserved from it)
  prior/projects.md            optional projects.md from the previous run (project order is preserved from it)
  expected/[<label>/]          written by this script: README.md stack.md projects.md my-day.md

Deviations from a plain Update-StackSummary call (documented as quirks in the spec):
  - Update-StackMetadata / Update-TaskDates are disabled: date-driven edits belong to task-lifecycle.
  - Get-ChildItem returns files in ordinal name order (legacy uses raw directory order).
  - Get-Date is frozen at now.txt.
#>
param(
  [Parameter(Mandatory)][string]$LegacyRoot,
  [Parameter(Mandatory)][string]$CaseDir
)
$ErrorActionPreference = 'Stop'
$WarningPreference = 'SilentlyContinue'
$CaseDir = (Resolve-Path $CaseDir).Path
$LegacyRoot = (Resolve-Path $LegacyRoot).Path

$work = Join-Path ([IO.Path]::GetTempPath()) ("stack-parity-" + [guid]::NewGuid())
New-Item -ItemType Directory $work | Out-Null

# Legacy iterates .NET Hashtables whose order is randomized per process, so ties in projects.md and
# my-day.md differ between runs. Load the code from a scratch copy with those dictionaries insertion-ordered.
$ps = Join-Path $LegacyRoot 'src/PowerShell'
$patched = Join-Path $work '_legacy'
New-Item -ItemType Directory $patched | Out-Null
$names = 'tasksByRoot|uniqueCandidates|projectCapacities|timeBlockGroups|projectCapacityUsed|projectCapacityTotals|projectCapacityUsedTotals'
foreach ($dir in 'Private', 'Public') {
  foreach ($f in Microsoft.PowerShell.Management\Get-ChildItem (Join-Path $ps "$dir/*.ps1") -File | Sort-Object Name) {
    $text = [IO.File]::ReadAllText($f.FullName)
    $text = [regex]::Replace($text, "(\`$(?:$names)\s*=\s*)@\{\}", '$1[ordered]@{}')
    $text = [regex]::Replace($text, "(\`$(?:$names))\.ContainsKey\(", '$1.Contains(')
    $tmp = Join-Path $patched "$dir-$($f.Name)"
    [IO.File]::WriteAllText($tmp, $text)
    . $tmp
  }
}

function Get-Date { Microsoft.PowerShell.Utility\Get-Date -Date $script:FixedNow @args }
function Get-ChildItem {
  $items = @(Microsoft.PowerShell.Management\Get-ChildItem @args)
  if ($items.Count -gt 1) {
    $keys = [string[]]($items | ForEach-Object { $_.Name })
    $arr = [object[]]$items
    [Array]::Sort($keys, $arr, [StringComparer]::Ordinal)
    return $arr
  }
  return $items
}
function Update-StackMetadata { param($TasksPath) [pscustomobject]@{ Success = $true; FeaturesExecuted = 0; Errors = @() } }
function Update-TaskDates { param($Projects, $CurrentDate, $ConfigPath) }

# One run per now*.txt: now.txt writes expected/, now-<label>.txt writes expected/<label>/.
foreach ($nowFile in Microsoft.PowerShell.Management\Get-ChildItem $CaseDir -Filter 'now*.txt' -File) {
  $label = $nowFile.BaseName -replace '^now-?', ''
  $script:FixedNow = [DateTimeOffset]::Parse((Get-Content $nowFile.FullName -Raw).Trim()).LocalDateTime
  $run = Join-Path $work "run-$label"
  New-Item -ItemType Directory $run | Out-Null
  Copy-Item (Join-Path $CaseDir 'tasks') (Join-Path $run 'tasks') -Recurse
  if (Test-Path (Join-Path $CaseDir '.xe')) { Copy-Item (Join-Path $CaseDir '.xe') (Join-Path $run '.xe') -Recurse }
  foreach ($f in 'README.md', 'projects.md') {
    $p = Join-Path $CaseDir "prior/$f"
    if (Test-Path $p) { Copy-Item $p (Join-Path $run $f) }
  }
  $Script:StackConfigurationCache.Configuration = $null
  Set-Location $run
  $result = Update-StackSummary -TasksPath './tasks' -OutputPath '.'
  if (-not $result.Success) { throw "legacy generation failed: $($result.Error)" }
  $out = if ($label) { Join-Path $CaseDir "expected/$label" } else { Join-Path $CaseDir 'expected' }
  New-Item -ItemType Directory $out -Force | Out-Null
  # my-day.md is not written when there are no tasks (legacy fails to bind an empty list and only warns).
  foreach ($f in 'README.md', 'stack.md', 'projects.md', 'my-day.md') { if (Test-Path (Join-Path $run $f)) { Copy-Item (Join-Path $run $f) (Join-Path $out $f) -Force } }
  Set-Location $CaseDir
}
Remove-Item $work -Recurse -Force
