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
$fsi.ChooseImageDefaultsForMediaType(12)
$fsi.FileSystemsToCreate = 7 # ISO9660 + Joliet + UDF

$fsi.Root.AddTree($Source, $false)

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
