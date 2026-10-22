# Regenerates tests/fixtures/summaries-sort.json from PowerShell Sort-Object (unstable, .NET introsort).
# Usage: pwsh generate-sort-golden.ps1 > ../fixtures/summaries-sort.json
$r = [Random]::new(7)
$out = @()
foreach ($n in 5, 17, 40, 100) {
  $items = 0..($n-1) | ForEach-Object { [pscustomobject]@{ Id = $_; Score = [double]$r.Next(0, [Math]::Max(3, [int]($n/4))) } }
  $sorted = $items | Sort-Object Score -Descending
  $out += [pscustomobject]@{ n = $n; scores = @($items | ForEach-Object Score); ids = @($sorted | ForEach-Object Id) }
}
$out | ConvertTo-Json -Depth 5 -Compress
