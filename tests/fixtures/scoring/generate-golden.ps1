<#
Regenerates golden.json from the LEGACY PowerShell implementation (read-only copy).

Usage (run from a scratch COPY of the legacy repo; never run against the live legacy repo):
  pwsh generate-golden.ps1 -LegacyRoot <copy-of-legacy-repo> -TasksPath <tasks dir> -OutFile <golden.json>

The copy must contain src/PowerShell and .xe/config/stack.json (legacy config = Stack defaults).
#>
param(
  [Parameter(Mandatory)][string]$LegacyRoot,
  [Parameter(Mandatory)][string]$TasksPath,
  [Parameter(Mandatory)][string]$OutFile
)
$ErrorActionPreference = 'Stop'
$WarningPreference = 'SilentlyContinue'
Set-Location $LegacyRoot
$ps = Join-Path $LegacyRoot 'src/PowerShell'
foreach ($f in Get-ChildItem (Join-Path $ps 'Private/*.ps1') -File) { . $f.FullName }
foreach ($f in Get-ChildItem (Join-Path $ps 'Public/*.ps1') -File) { . $f.FullName }

$emptyOut = Join-Path ([IO.Path]::GetTempPath()) ("golden-" + [guid]::NewGuid())
New-Item -ItemType Directory $emptyOut | Out-Null
# Deterministic discovery order (name ascending); legacy falls back to directory order.
$projects = Get-StackProjects -TasksPath $TasksPath -OutputPath $emptyOut
$files = Get-ChildItem $TasksPath -Filter '*.md' | Sort-Object Name

$allTasks = @()
foreach ($p in $projects) { $allTasks += ConvertFrom-StackMarkdown -MarkdownContent $p.Content -ProjectMetadata $p }
$scored = Get-StackTaskScore -Tasks $allTasks -Projects $projects -IncludeBreakdown
$sorted = @($scored | Sort-Object Score -Descending)

function Convert-Task($t) {
  $b = $t.Breakdown
  [ordered]@{
    id = $t.Id; project = $t.ProjectName; text = $t.Text; level = $t.Level; parent = $t.Parent
    leaf = [bool]$t.IsLeafNode; position = $t.ActiveSectionPosition; totalLeaves = $t.TotalActiveLeafTasks
    parked = [bool](Test-TaskParked -Task $t -AllTasks $scored)
    score = [double]$t.Score
    breakdown = [ordered]@{
      emojiContributions = @($b.EmojiContributions | ForEach-Object { [ordered]@{ category = $_.Category; emoji = $_.Emoji; value = $_.Value } })
      projectBonus = [double]$b.ProjectBonus; placementBonus = [double]$b.PlacementBonus
      baseScore = [double]$b.BaseScore; effortHours = [double]$b.EffortHours; calculatedTotal = [double]$b.CalculatedTotal
    }
  }
}

$instants = @(
  '2026-10-21T17:00:00Z', # Wed 10:00 PDT  Work
  '2026-10-21T23:30:00Z', # Wed 16:30 PDT  Family evening
  '2026-10-22T03:30:00Z', # Wed 20:30 PDT  Shichael
  '2026-10-22T07:00:00Z', # Thu 00:00 PDT  Project (overnight)
  '2026-10-22T11:00:00Z', # Thu 04:00 PDT  Sleep
  '2026-10-24T17:00:00Z', # Sat 10:00 PDT  Family weekend
  '2026-10-25T04:30:00Z', # Sat 21:30 PDT  Shichael
  '2026-10-21T23:00:00Z', # Wed 16:00:00 PDT  boundary: Work end inclusive + Family start
  '2026-10-21T23:00:01Z', # Wed 16:00:01 PDT  just past boundary
  '2026-11-04T16:30:00Z'  # Wed 08:30 PST  after DST change, Work
)
$filtered = foreach ($iso in $instants) {
  $at = [DateTime]::Parse($iso, $null, [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal)
  $at = [DateTime]::SpecifyKind($at, [DateTimeKind]::Utc)
  $active = @(Get-ActiveTimeBlocks -CurrentTime $at)
  $cands = @($sorted | Where-Object { $_.IsLeafNode -and -not (Test-TaskParked -Task $_ -AllTasks $scored) })
  $kept = if ($cands.Count) { @(Filter-TasksByTimeBlock -Tasks $cands -WorkContext @{ CurrentTime = $at } -Projects $projects) } else { @() }
  [ordered]@{ at = $iso; activeBlocks = $active; ids = @($kept | ForEach-Object { $_.Id }) }
}

$out = [ordered]@{
  generatedFrom = 'legacy Get-StackProjects + ConvertFrom-StackMarkdown + Get-StackTaskScore + Filter-TasksByTimeBlock'
  projects = @($projects | ForEach-Object { [ordered]@{ name = $_.Name; valueScore = [double]$_.ValueScore; calculatedPriority = [double]$_.CalculatedPriority; weight = [double]$_.Weight } })
  ranking = @($sorted | ForEach-Object { $_.Id })
  tasks = @($sorted | ForEach-Object { Convert-Task $_ })
  filtered = @($filtered)
}
$out | ConvertTo-Json -Depth 8 | Set-Content -Path $OutFile -Encoding utf8
Remove-Item $emptyOut -Recurse -Force
