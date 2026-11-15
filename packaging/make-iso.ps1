param(
    [string]$Source = "$PSScriptRoot\..\build\SURGE",
    [string]$Destination = "$PSScriptRoot\..\SurgeOS-Portable.iso",
    [string]$VolumeLabel = "SURGE_OS"
)

$ErrorActionPreference = 'Stop'
$Source = (Resolve-Path $Source).Path
Write-Host "Creating ISO from $Source ..." -ForegroundColor Cyan

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

public static class IsoStreamCopier {
    public static void Copy(object comObj, string destPath) {
        var istream = (IStream)comObj;
        using (var fs = new FileStream(destPath, FileMode.Create, FileAccess.Write, FileShare.None, 2 * 1024 * 1024)) {
            byte[] buffer = new byte[2 * 1024 * 1024];
            IntPtr pBytesRead = Marshal.AllocHGlobal(sizeof(int));
            try {
                while (true) {
                    istream.Read(buffer, buffer.Length, pBytesRead);
                    int read = Marshal.ReadInt32(pBytesRead);
                    if (read <= 0) break;
                    fs.Write(buffer, 0, read);
                }
            } finally {
                Marshal.FreeHGlobal(pBytesRead);
            }
        }
    }
}
"@

$fsi = New-Object -ComObject IMAPI2FS.MsftFileSystemImage
$fsi.VolumeName = $VolumeLabel
$fsi.ChooseImageDefaultsForMediaType(6)
$fsi.FileSystemsToCreate = 7

$bootBin = "C:\Windows\Boot\DVD\EFI\en-US\efisys.bin"
if (-not (Test-Path $bootBin)) {
    $bootBin = "C:\Windows\Boot\DVD\EFI\en-US\efisys_noprompt.bin"
}
if (Test-Path $bootBin) {
    $boot = New-Object -ComObject IMAPI2FS.BootOptions
    $bootStream = New-Object -ComObject ADODB.Stream
    $bootStream.Type = 1
    $bootStream.Open()
    $bytes = [System.IO.File]::ReadAllBytes($bootBin)
    $bootStream.Write($bytes)
    $bootStream.Position = 0
    $boot.AssignBootImage($bootStream)
    $boot.PlatformId = 0xEF
    $boot.Emulation = 0
    $fsi.BootImageOptions = $boot
}

$visibleNames = @('Surge.exe', 'Data', 'Documents', 'Downloads', 'README.txt')

Get-ChildItem -Path $Source -Force | ForEach-Object {
    if ($visibleNames -notcontains $_.Name) {
        try {
            $_.Attributes = $_.Attributes -bor [System.IO.FileAttributes]::Hidden
        } catch { }
    }
}

$fsi.Root.AddTree($Source, $false)

foreach ($item in $fsi.Root) {
    if ($visibleNames -notcontains $item.Name) {
        try {
            $item.IsHidden = $true
        } catch { }
    }
}

$resultImage = $fsi.CreateResultImage()
$imageStream = $resultImage.ImageStream

try {
    [IsoStreamCopier]::Copy($imageStream, $Destination)
}
finally {
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($imageStream) | Out-Null
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($resultImage) | Out-Null
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($fsi) | Out-Null
}

$file = Get-Item $Destination
Write-Host "ISO created successfully at $($file.FullName) ($([math]::Round($file.Length / 1MB, 2)) MB)" -ForegroundColor Green
