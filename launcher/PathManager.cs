using System.Security.Cryptography;
using System.Text;

namespace SurgePortable;

internal sealed record StorageInfo(long TotalBytes, long FreeBytes)
{
    public long UsedBytes => TotalBytes - FreeBytes;
    public bool LowSpace => FreeBytes < 1_000_000_000L;
    public bool CriticalSpace => FreeBytes < 500_000_000L;
}

internal sealed class PathManager
{
    public const long MaxDocumentBytes = 32L * 1024 * 1024;
    public const long MaxVaultBytes = 8L * 1024 * 1024;

    private static readonly string[] ProtectedEntries = ["Surge.exe", "Browser", "Interface", "resources", "locales", "README.txt", "Data/PasswordVault"];

    private PathManager(string root) => Root = root;

    public string Root { get; }
    public bool IsReadOnly { get; private set; }
    public string WritableRoot => IsReadOnly ? Path.Combine(Path.GetTempPath(), "Surge_Session_" + Environment.UserName) : Root;
    public string BrowserDir => Path.Combine(Root, "Browser");
    public string InterfaceDir => Path.Combine(Root, "Interface");
    public string DataDir => Path.Combine(WritableRoot, "Data");
    public string ProfileDir => Path.Combine(DataDir, "Profile");
    public string NotesDir => Path.Combine(DataDir, "Notes");
    public string BookmarksDir => Path.Combine(DataDir, "Bookmarks");
    public string SettingsDir => Path.Combine(DataDir, "Settings");
    public string VaultDir => Path.Combine(DataDir, "PasswordVault");
    public string DownloadsDir => IsReadOnly ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads") : Path.Combine(Root, "Downloads");
    public string DocumentsDir => IsReadOnly ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments)) : Path.Combine(Root, "Documents");

    private static readonly HashSet<string> SystemDirectories = new(StringComparer.OrdinalIgnoreCase)
    {
        "Interface", "Browser", "Data", "Licenses", "resources", "locales",
        "bin", "obj", "node_modules", "packaging", "launcher", "installer", "desktop", "scratch", "build",
    };

    private static readonly HashSet<string> SystemFiles = new(StringComparer.OrdinalIgnoreCase)
    {
        "Surge.exe", "Surge-Setup.exe", "Uninstall.exe", "SurgeOS-Portable.iso",
        "app.zip", "portable.flag", "installed.flag", "README.txt",
        "serve.mjs", "package.json", "package-lock.json",
        "desktop.cjs", "workspace-preload.cjs", "main.cjs", "browser-preload.cjs",
        "license", "license.txt", "license.rtf"
    };

    private static readonly HashSet<string> SystemExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".exe", ".dll", ".sys", ".drv", ".com", ".pak", ".bin", ".dat", ".pdb", ".flag", ".node",
        ".cs", ".csproj", ".sln", ".mjs", ".cjs"
    };

    public bool IsSystemOrCodeItem(string name, bool isDirectory)
    {
        if (string.IsNullOrWhiteSpace(name))
            return true;
        if (name.StartsWith('.'))
            return true;
        if (isDirectory)
            return SystemDirectories.Contains(name);

        if (SystemFiles.Contains(name))
            return true;

        string ext = Path.GetExtension(name);
        if (!string.IsNullOrEmpty(ext) && SystemExtensions.Contains(ext))
            return true;

        return false;
    }

    public bool IsSystemOrCodePath(string fullPath)
    {
        string rel = ToRelative(fullPath);
        if (string.IsNullOrWhiteSpace(rel))
            return false;

        string[] parts = rel.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0)
            return false;

        if (SystemDirectories.Contains(parts[0]) || parts.Any(p => p.StartsWith('.')))
            return true;

        string leaf = parts[^1];
        if (SystemFiles.Contains(leaf))
            return true;

        string ext = Path.GetExtension(leaf);
        if (!string.IsNullOrEmpty(ext) && SystemExtensions.Contains(ext))
            return true;

        return false;
    }

    public bool UsbPresent => Directory.Exists(Root);
    public bool IsInstalled { get; set; }

    public static PathManager Detect(string? root = null)
    {
        PathManager manager;
        if (root is not null)
        {
            if (!Path.IsPathFullyQualified(root) || !Directory.Exists(root))
                throw new DirectoryNotFoundException("The Surge workspace folder does not exist.");
            manager = new PathManager(Path.TrimEndingDirectorySeparator(Path.GetFullPath(root)));
        }
        else
        {
            string exe = Environment.ProcessPath
                ?? throw new InvalidOperationException("Cannot determine the Surge executable location.");
            string dir = Path.GetDirectoryName(exe)
                ?? throw new InvalidOperationException("Cannot determine the Surge USB folder.");
            manager = new PathManager(Path.GetFullPath(dir));
        }

        manager.DetectReadOnly();
        return manager;
    }

    private void DetectReadOnly()
    {
        try
        {
            var drive = new DriveInfo(Path.GetPathRoot(Root)!);
            if (drive.DriveType == DriveType.CDRom)
            {
                IsReadOnly = true;
                return;
            }
        }
        catch { }

        try
        {
            string probe = Path.Combine(Root, ".write_probe_" + Environment.ProcessId);
            File.WriteAllText(probe, "1");
            File.Delete(probe);
        }
        catch
        {
            IsReadOnly = true;
        }
    }

    public string MutexName()
    {
        byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes(Root.ToLowerInvariant()));
        return @"Local\SurgePortable." + Convert.ToHexString(hash.AsSpan(0, 8));
    }

    public void EnsureDataDirectories()
    {
        if (!UsbPresent)
            throw new DriveNotFoundException($"The Surge drive is no longer available at {Root}.");

        try
        {
            foreach (string dir in new[] { DataDir, ProfileDir, NotesDir, BookmarksDir, SettingsDir, VaultDir, DownloadsDir, DocumentsDir })
                Directory.CreateDirectory(dir);
        }
        catch (UnauthorizedAccessException)
        {
        }
    }

    public StorageInfo GetStorage()
    {
        try
        {
            string targetPath = IsReadOnly ? WritableRoot : Root;
            var drive = new DriveInfo(Path.GetPathRoot(targetPath)!);
            return new StorageInfo(drive.TotalSize, drive.AvailableFreeSpace);
        }
        catch
        {
            return new StorageInfo(10L * 1024 * 1024 * 1024, 5L * 1024 * 1024 * 1024);
        }
    }

    public string ToRelative(string fullPath)
    {
        string rel = Path.GetRelativePath(Root, fullPath);
        return rel == "." ? string.Empty : rel.Replace('\\', '/');
    }

    public bool IsProtected(string fullPath)
    {

        string rel = string.Join('/', ToRelative(Path.GetFullPath(fullPath)).Split('/')
            .Select(part => part.TrimEnd('.', ' ')));

        return rel.Length == 0 || rel.Equals("Data", StringComparison.OrdinalIgnoreCase) ||
            ProtectedEntries.Any(p => rel.Equals(p, StringComparison.OrdinalIgnoreCase) ||
            rel.StartsWith(p + "/", StringComparison.OrdinalIgnoreCase)) ||
            (!rel.Contains('/') && Path.GetExtension(rel).ToLowerInvariant() is ".exe" or ".dll" or ".pak" or ".bin" or ".dat");
    }

    public bool TryResolve(string? relative, out string fullPath, out string error)
    {
        fullPath = Root;
        error = string.Empty;

        if (string.IsNullOrWhiteSpace(relative))
            return true;

        if (relative.Contains('\0'))
        {
            error = "Invalid path characters.";
            return false;
        }

        if (IsInstalled && Path.IsPathFullyQualified(relative))
        {
            if (File.Exists(relative) || Directory.Exists(relative))
            {
                fullPath = Path.GetFullPath(relative);
                return true;
            }
        }

        if (!IsInstalled && (relative.Contains(':') || relative.StartsWith('/') || relative.StartsWith('\\')))
        {
            error = "Only paths inside the Surge USB folder are allowed.";
            return false;
        }

        string[] parts = relative.Split(['/', '\\'], StringSplitOptions.RemoveEmptyEntries);
        if (!IsInstalled && parts.Any(p => p == ".."))
        {
            error = "Paths may not leave the Surge USB folder.";
            return false;
        }

        string candidate = Path.GetFullPath(Path.Combine(Root, Path.Combine(parts)));
        if (!IsInstalled && !candidate.Equals(Root, StringComparison.OrdinalIgnoreCase) &&
            !candidate.StartsWith(Root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
        {
            error = "Paths may not leave the Surge USB folder.";
            return false;
        }

        if (!IsInstalled && ContainsLink(candidate))
        {
            error = "Linked folders are not supported by the Surge file manager.";
            return false;
        }

        fullPath = candidate;
        return true;
    }

    private bool ContainsLink(string candidate)
    {
        string? current = candidate;
        while (current is not null && current.StartsWith(Root, StringComparison.OrdinalIgnoreCase))
        {
            if ((Directory.Exists(current) || File.Exists(current)) &&
                File.GetAttributes(current).HasFlag(FileAttributes.ReparsePoint))
                return true;
            if (current.Equals(Root, StringComparison.OrdinalIgnoreCase))
                break;
            current = Path.GetDirectoryName(current);
        }
        return false;
    }
}
