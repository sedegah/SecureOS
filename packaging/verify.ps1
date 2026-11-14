[CmdletBinding()]
param(
    [string]$Destination,
    [switch]$SkipSmokeTest
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $Destination) { $Destination = Join-Path $repoRoot 'build\SURGE' }

$failures = New-Object System.Collections.Generic.List[string]
function Check {
    param([string]$Name, [scriptblock]$Test)
    try {
        $result = & $Test
        if ($result -eq $false) { throw 'check returned false' }
        Write-Host "  ok   $Name" -ForegroundColor Green
    } catch {
        Write-Host "  FAIL $Name - $($_.Exception.Message)" -ForegroundColor Red
        $failures.Add($Name)
    }
}

Write-Host "Verifying $Destination" -ForegroundColor Cyan

$required = @(
    'Surge.exe',
    'README.txt',
    'Interface\index.html',
    'Interface\styles.css',
    'Interface\app.js',
    'Interface\assets\surge.svg',
    'Interface\vendor\argon2.umd.min.js',
    'Interface\modules\api.js',
    'Interface\modules\ui.js',
    'Interface\modules\icons.js',
    'Interface\modules\files.js',
    'Interface\modules\notes.js',
    'Interface\modules\bookmarks.js',
    'Interface\modules\downloads.js',
    'Interface\modules\passwords.js',
    'Interface\modules\settings.js',
    'Interface\modules\vault-crypto.js',
    'Data\Profile',
    'Data\Notes',
    'Data\Bookmarks',
    'Data\Settings',
    'Data\PasswordVault',
    'Downloads'
)

foreach ($item in $required) {
    Check "present: $item" { Test-Path (Join-Path $Destination $item) }
}

Check 'Firefox runtime present' {
    $candidates = @(
        'Browser\FirefoxPortable\App\Firefox64\firefox.exe',
        'Browser\FirefoxPortable\App\Firefox\firefox.exe',
        'Browser\Firefox\firefox.exe'
    )
    foreach ($candidate in $candidates) {
        if (Test-Path (Join-Path $Destination $candidate)) { return $true }
    }
    return $false
}

Check 'launcher under 20MB' {
    $mb = (Get-Item (Join-Path $Destination 'Surge.exe')).Length / 1MB
    Write-Host "       launcher: $([math]::Round($mb, 2)) MB"
    return ($mb -lt 20)
}

Check 'interface under 5MB' {
    $mb = (Get-ChildItem (Join-Path $Destination 'Interface') -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
    Write-Host "       interface: $([math]::Round($mb, 2)) MB"
    return ($mb -lt 5)
}

Check 'no hardcoded drive paths in interface' {
    $hits = Select-String -Path (Join-Path $Destination 'Interface\*.js'), (Join-Path $Destination 'Interface\modules\*.js') -Pattern '[A-Za-z]:\\\\' -AllMatches
    return ($null -eq $hits)
}

Check 'no plaintext vault or master password files' {
    $bad = Get-ChildItem (Join-Path $Destination 'Data') -Recurse -File |
        Where-Object { $_.Name -match 'password|master|secret' -and $_.Extension -ne '.enc' }
    return ($null -eq $bad)
}

if (-not $SkipSmokeTest) {
    Write-Host 'Smoke test: starting the helper without a browser...' -ForegroundColor Cyan
    $exe = Join-Path $Destination 'Surge.exe'
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $exe
    $psi.Arguments = '--no-browser'
    $psi.WorkingDirectory = $Destination
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::Start($psi)

    try {
        $url = $null
        $deadline = (Get-Date).AddSeconds(30)
        while ((Get-Date) -lt $deadline -and -not $url) {
            if ($process.HasExited) { throw "Surge.exe exited early: $($process.StandardError.ReadToEnd())" }
            $line = $process.StandardOutput.ReadLine()
            if ($line -like 'SURGE_URL=*') { $url = $line.Substring('SURGE_URL='.Length) }
        }
        if (-not $url) { throw 'Surge.exe did not report its local URL.' }

        $base = (($url -split '#')[0]).TrimEnd('/')
        $token = ($url -split 'k=')[1]

        Check 'helper answers /api/status with a token' {
            $response = Invoke-RestMethod -Uri "$base/api/status" -Headers @{ 'X-Surge-Token' = $token }
            Write-Host "       usbRoot: $($response.usbRoot)"
            return ($response.usbPresent -eq $true -and $response.app -eq 'Surge Portable')
        }

        Check 'helper rejects requests without a token' {
            try {
                Invoke-RestMethod -Uri "$base/api/status" | Out-Null
                return $false
            } catch {
                return ($_.Exception.Response.StatusCode.value__ -eq 401)
            }
        }

        Check 'helper refuses path traversal' {
            try {
                Invoke-RestMethod -Uri "$base/api/files?path=../../Windows" -Headers @{ 'X-Surge-Token' = $token } | Out-Null
                return $false
            } catch {
                return ($_.Exception.Response.StatusCode.value__ -eq 400)
            }
        }

        Check 'homepage is served' {
            $response = Invoke-WebRequest -Uri "$base/" -UseBasicParsing
            return ($response.StatusCode -eq 200 -and $response.Content -match 'Surge Portable')
        }

        Check 'notes directory exists without modifying user data' {
            return (Test-Path (Join-Path $Destination 'Data\Notes') -PathType Container)
        }
    } finally {
        if (-not $process.HasExited) { $process.Kill() }
        $process.WaitForExit(5000) | Out-Null
        $process.Dispose()
    }
}

Write-Host ''
if ($failures.Count -gt 0) {
    Write-Host "$($failures.Count) check(s) failed:" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}
Write-Host 'All verification checks passed.' -ForegroundColor Green
exit 0