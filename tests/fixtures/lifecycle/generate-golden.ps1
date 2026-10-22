<#
Regenerates expected/*.md from the LEGACY PowerShell implementation (read-only copy).

Usage (run from a scratch COPY of the legacy repo; never run against the live legacy repo):
  pwsh generate-golden.ps1 -LegacyRoot <copy-of-legacy-repo>

Each case in cases.json is applied to a copy of input/<file>.md by the legacy functions
(Set-Task, Set-TaskParking, Remove-TaskParking, Remove-TaskFromProject, Remove-CompletedTasksFromProject,
New-ProjectFile, Update-TaskDates). Sweep case: the legacy start-date sweep reads the real clock, so run it
on 2026-10-22 (the tests pin that date) or edit the dates in input/sweep.md and the tests together.
Legacy writes through Get-Content/Out-File, so expected files carry legacy's output exactly.
#>
param([Parameter(Mandatory)][string]$LegacyRoot)
$ErrorActionPreference = 'Stop'
$WarningPreference = 'SilentlyContinue'
Set-Location $LegacyRoot
$ps = Join-Path $LegacyRoot 'src/PowerShell'
foreach ($f in Microsoft.PowerShell.management\Get-ChildItem (Join-Path $ps 'Private/*.ps1') -File) { . $f.FullName }
foreach ($f in Microsoft.PowerShell.management\Get-ChildItem (Join-Path $ps 'Public/*.ps1') -File) { . $f.FullName }

$here = $PSScriptRoot
$cases = Get-Content (Join-Path $here 'cases.json') -Raw -Encoding utf8 | ConvertFrom-Json
$work = Join-Path ([IO.Path]::GetTempPath()) ("golden-" + [guid]::NewGuid())
New-Item -ItemType Directory $work | Out-Null

foreach ($c in $cases) {
  $out = Join-Path $here "expected/$($c.name).md"
  $file = Join-Path $work "$($c.name).md"
  if ($c.file) { Copy-Item (Join-Path $here "input/$($c.file).md") $file }
  $line = $null
  if ($c.match) {
    $all = @(Get-Content $file -Encoding utf8)
    $line = ($all | ForEach-Object -Begin { $i = 0 } -Process { if ($_ -like "*$($c.match)*") { $i }; $i++ } | Select-Object -First 1)
  }
  $loc = @{ LineNumber = $line }
  $a = $c.args
  switch ($c.op) {
    'start'            { Set-Task -ProjectFilePath $file -TaskLocation $loc -Status '🚧' }
    'complete'         {
      $p = @{ ProjectFilePath = $file; TaskLocation = $loc; CheckboxState = 'Complete'; Status = 'None' }
      if ($a.summary) { $p.CompletionSummary = $a.summary }
      Set-Task @p
    }
    'complete-remove'  { Remove-TaskFromProject -ProjectFilePath $file -TaskLocation $loc }
    'skip'             { Set-TaskParking -ProjectFilePath $file -TaskLocation $loc }
    'resume'           { Remove-TaskParking -ProjectFilePath $file -TaskLocation $loc }
    'suspend'          { Set-Task -ProjectFilePath $file -TaskLocation $loc -SuspendDate $a.when }
    'set'              {
      $p = @{ ProjectFilePath = $file; TaskLocation = $loc }
      foreach ($k in 'status','priority','effort','impact') { if ($a.$k) { $p[(Get-Culture).TextInfo.ToTitleCase($k)] = $a.$k } }
      if ($a.checkbox) { $p.CheckboxState = $a.checkbox }
      if ($a.removeAllEmojis) { $p.RemoveAllEmojis = $true }
      Set-Task @p
    }
    'remove-completed' { Remove-CompletedTasksFromProject -FilePath $file | Out-Null }
    'sweep'            {
      $content = Get-Content $file -Raw -Encoding utf8
      $proj = @{ Name = 'sweep'; Content = $content }
      Update-TaskDates -Projects @($proj) -CurrentDate ([datetime]'2026-10-22T10:00:00')
      [IO.File]::WriteAllText($file, $proj.Content, (New-Object Text.UTF8Encoding($true)))
    }
    'add-project'      {
      $p = @{ FilePath = $file; ProjectName = $a.name }
      if ($a.description) { $p.Description = $a.description }
      if ($a.repositoryUrl) { $p.RepositoryUrl = $a.repositoryUrl }
      if ($a.aliases) { $p.Aliases = @($a.aliases) }
      if ($a.priority) { $p.ProjectPriority = [int]$a.priority }
      if ($a.capacity) { $h = [ordered]@{}; $a.capacity.PSObject.Properties | ForEach-Object { $h[$_.Name] = $_.Value }; $p.TimeBlockCapacity = $h }
      New-ProjectFile @p
    }
    default { throw "unknown op $($c.op)" }
  }
  Copy-Item $file $out -Force
}
Remove-Item $work -Recurse -Force
