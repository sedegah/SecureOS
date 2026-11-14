[CmdletBinding()]
param(
    [string]$Destination,
    [string]$BrowserSource,
    [switch]$DownloadBrowser,
    [switch]$SkipBrowser,
    [string]$SevenZip,
    [string]$FirefoxLanguage = 'en-US'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $Destination) { $Destination = Join-Path $repoRoot 'build\SURGE' }
$cacheDir = Join-Path $repoRoot 'build\cache'

function Find-SevenZip {
    param([string]$Explicit)
    if ($Explicit) {
        if (-not (Test-Path $Explicit)) { throw "7-Zip not found at $Explicit" }
        return (Resolve-Path $Explicit).Path
    }
    foreach ($name in @('7z.exe', '7za.exe', '7zr.exe')) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command) { return $command.Source }
    }
    foreach ($path in @("$env:ProgramFiles\7-Zip\7z.exe", "${env:ProgramFiles(x86)}\7-Zip\7z.exe", "$env:LOCALAPPDATA\Programs\7-Zip\7z.exe")) {
        if (Test-Path $path) { return $path }
    }
    throw '7-Zip is needed to unpack Firefox. Install 7-Zip, or pass -SevenZip <path to 7z.exe>, or copy an existing Firefox folder with -BrowserSource.'
}

function Copy-FirefoxRuntime {
    param([string]$SourcePath, [string]$TargetDir)

    $runtimeDir = $null
    $temp = $null
    if (Test-Path $SourcePath -PathType Container) {
        $found = Get-ChildItem $SourcePath -Recurse -Filter 'firefox.exe' -File | Select-Object -First 1
        if (-not $found) { throw "No firefox.exe found under $SourcePath" }
        $runtimeDir = $found.DirectoryName
    } else {
        $extractor = Find-SevenZip -Explicit $SevenZip
        $temp = Join-Path $cacheDir ('extract-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $temp -Force | Out-Null
        Write-Host "Unpacking $([System.IO.Path]::GetFileName($SourcePath)) with $extractor ..."
        & $extractor x $SourcePath "-o$temp" -y | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "7-Zip could not unpack $SourcePath (exit $LASTEXITCODE)." }
        $found = Get-ChildItem $temp -Recurse -Filter 'firefox.exe' -File | Select-Object -First 1
        if (-not $found) { throw "No firefox.exe found inside $SourcePath" }
        $runtimeDir = $found.DirectoryName
    }

    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
    Write-Host "Copying Firefox runtime from $runtimeDir"
    Copy-Item -Path (Join-Path $runtimeDir '*') -Destination $TargetDir -Recurse -Force
    if ($temp -and (Test-Path $temp)) { Remove-Item $temp -Recurse -Force }
}

Write-Host "Assembling Surge Portable in $Destination" -ForegroundColor Cyan

$exe = & (Join-Path $PSScriptRoot 'build.ps1')
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
Copy-Item $exe (Join-Path $Destination 'Surge.exe') -Force

$interfaceTarget = Join-Path $Destination 'Interface'
if (Test-Path $interfaceTarget) { Remove-Item $interfaceTarget -Recurse -Force }
Copy-Item (Join-Path $repoRoot 'interface') $interfaceTarget -Recurse -Force

foreach ($dir in @('Data\Profile', 'Data\Notes', 'Data\Bookmarks', 'Data\Settings', 'Data\PasswordVault', 'Downloads', 'Browser')) {
    New-Item -ItemType Directory -Path (Join-Path $Destination $dir) -Force | Out-Null
}

$licensesTarget = Join-Path $Destination 'Licenses'
if (Test-Path (Join-Path $repoRoot 'LICENSES')) {
    if (Test-Path $licensesTarget) { Remove-Item $licensesTarget -Recurse -Force }
    Copy-Item (Join-Path $repoRoot 'LICENSES') $licensesTarget -Recurse -Force
}

$browserTarget = Join-Path $Destination 'Browser\FirefoxPortable\App\Firefox64'
$browserExe = Join-Path $browserTarget 'firefox.exe'

if ($SkipBrowser) {
    Write-Warning 'Skipping the browser. Surge.exe will report a missing browser until one is added.'
} elseif ($BrowserSource) {
    if (-not (Test-Path $BrowserSource)) { throw "Browser source not found: $BrowserSource" }
    Copy-FirefoxRuntime -SourcePath $BrowserSource -TargetDir $browserTarget
} elseif ($DownloadBrowser) {
    New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
    $msi = Join-Path $cacheDir "firefox-$FirefoxLanguage-win64.msi"
    $url = "https://download.mozilla.org/?product=firefox-msi-latest-ssl&os=win64&lang=$FirefoxLanguage"
    if (-not (Test-Path $msi)) {
        Write-Host "Downloading official Firefox (win64, $FirefoxLanguage)..."
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $url -OutFile $msi -UseBasicParsing
    }
    Copy-FirefoxRuntime -SourcePath $msi -TargetDir $browserTarget
} elseif (Test-Path $browserExe) {
    Write-Host 'Keeping the Firefox runtime already present in the package.'
} else {
    throw 'No browser in this package. Re-run with -DownloadBrowser, or -BrowserSource <Firefox folder | Firefox MSI | Firefox Setup.exe | FirefoxPortable .paf.exe>, or -SkipBrowser to package without it.'
}

$readme = @'
SURGE PORTABLE 1.0 - 16GB EDITION
=================================

START HERE
  1. Keep this whole SURGE folder on the USB drive.
  2. Double-click Surge.exe.
  3. Firefox opens with the Surge workspace as its homepage.

No installation, no administrator rights, no cloud account. Surge works offline;
the internet is only needed for the websites you visit.

WHAT IS ON THIS DRIVE
  Surge.exe                  Launcher and local workspace helper
  Browser\                   Firefox runtime (profile stays on this USB)
  Interface\                 Surge workspace pages
  Data\Profile\              Firefox profile: history, cookies, settings
  Data\Notes\notes.json      Your notes
  Data\Bookmarks\            Your Surge bookmark panel
  Data\Settings\             Workspace preferences
  Data\PasswordVault\        Encrypted password vault (vault.enc)
  Downloads\                 Everything Firefox downloads

BEFORE YOU UNPLUG
  Close Firefox, wait a moment for saves to finish, then use Windows
  "Safely Remove Hardware". Pulling the drive out while Surge is writing
  can damage notes, bookmarks or the vault.

PASSWORD VAULT
  The master password is never stored. If you forget it, the vault cannot
  be recovered. Keep a written copy somewhere safe, away from this drive.

PRIVACY
  Surge keeps your data on this USB drive, but Windows, antivirus software
  and websites can still leave traces on the computer you use. Surge is not
  a zero-trace or anonymity tool.

UPDATING FIREFOX
  Close Surge first. Replace the contents of Browser\FirefoxPortable\App\Firefox64
  with a newer Firefox runtime. Never replace Data\Profile - that is your data.

Details: see the docs folder in the Surge source repository (README, SECURITY,
USER_GUIDE). Firefox is distributed by Mozilla under the MPL 2.0; see Licenses.
'@
Set-Content -Path (Join-Path $Destination 'README.txt') -Value $readme -Encoding UTF8

$totalBytes = (Get-ChildItem $Destination -Recurse -File | Measure-Object Length -Sum).Sum
$totalGb = [math]::Round($totalBytes / 1GB, 2)
Write-Host ''
Write-Host "Package ready: $Destination" -ForegroundColor Green
Write-Host "Total size: $totalGb GB (16GB drive planning assumption: 14.5GB usable)"
if (Test-Path $browserExe) {
    $browserGb = [math]::Round(((Get-ChildItem (Join-Path $Destination 'Browser') -Recurse -File | Measure-Object Length -Sum).Sum / 1GB), 2)
    Write-Host "Browser: $browserGb GB"
}
if ($totalGb -gt 7.1) { Write-Warning 'Package is larger than the 7.1GB application budget in the storage plan.' }
Write-Host 'Copy the SURGE folder to the root of the USB drive, then run verify.ps1 -Destination <path> to check it.'