$src = "build\desktop\Surge-win32-x64"
$dst = "build\SURGE"

Copy-Item -Path "$src\*" -Destination $dst -Recurse -Force

if (-not (Test-Path "$dst\portable.flag")) {
    New-Item -Path "$dst\portable.flag" -ItemType File -Force | Out-Null
}
if (-not (Test-Path "$dst\Data")) {
    New-Item -Path "$dst\Data" -ItemType Directory -Force | Out-Null
}
if (-not (Test-Path "$dst\Documents")) {
    New-Item -Path "$dst\Documents" -ItemType Directory -Force | Out-Null
}
if (-not (Test-Path "$dst\Downloads")) {
    New-Item -Path "$dst\Downloads" -ItemType Directory -Force | Out-Null
}

$visible = @('Surge.exe', 'Data', 'Documents', 'Downloads', 'README.txt')
Get-ChildItem -Path $dst -Force | ForEach-Object {
    if ($visible -notcontains $_.Name) {
        $_.Attributes = $_.Attributes -bor [System.IO.FileAttributes]::Hidden
    } else {
        $_.Attributes = $_.Attributes -band (-bnot [System.IO.FileAttributes]::Hidden)
    }
}
Write-Host "SURGE directory synchronized with hidden attributes."
