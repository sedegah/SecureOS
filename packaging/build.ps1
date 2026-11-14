[CmdletBinding()]
param(
    [string]$Configuration = 'Release',
    [string]$Output
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $Output) { $Output = Join-Path $repoRoot 'build\publish' }

$project = Join-Path $repoRoot 'launcher\SurgeLauncher.csproj'
if (-not (Test-Path $project)) { throw "Launcher project not found: $project" }

Write-Host "Building Surge launcher ($Configuration)..." -ForegroundColor Cyan
& dotnet publish $project -c $Configuration -o $Output --nologo | Out-Host
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE." }

$exe = Join-Path $Output 'Surge.exe'
if (-not (Test-Path $exe)) { throw "Build did not produce Surge.exe in $Output" }

$sizeMb = [math]::Round((Get-Item $exe).Length / 1MB, 2)
Write-Host "Built $exe ($sizeMb MB)" -ForegroundColor Green
if ($sizeMb -gt 20) { Write-Warning "Launcher is larger than the 20MB design target." }

$interfaceDir = Join-Path $repoRoot 'interface'
$interfaceMb = [math]::Round(((Get-ChildItem $interfaceDir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 2)
Write-Host "Interface assets: $interfaceMb MB (target under 5MB)"
if ($interfaceMb -gt 5) { Write-Warning 'Interface assets are larger than the 5MB design target.' }

return $exe