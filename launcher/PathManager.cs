using System.Security.Cryptography;
using System.Text;

namespace SurgePortable;

internal sealed record StorageInfo(long TotalBytes, long FreeBytes)
{
    public long UsedBytes => TotalBytes - FreeBytes;
    public bool LowSpace => FreeBytes < 1_000_000_000L;
    public bool CriticalSpace => FreeBytes < 500_000_000L;
}

/// Every path is derived from the executable location at runtime, never from a fixed drive letter.
internal sealed class PathManager
{
    public const long MaxDocumentBytes = 32L * 1024 * 1024;
    public const long MaxVaultBytes = 8L * 1024 * 1024;

    private static readonly string[] ProtectedEntries = ["Surge.exe", "Browser", "Interface", "resources", "locales", "README.txt", "Data/PasswordVault"];

    private PathManager(string root) => Root = root;

    public string Root { get; }
    public string BrowserDir => Path.Combine(Root, "Browser");
    public string InterfaceDir => Path.Combine(Root, "Interface");
    public string DataDir => Path.Combine(Root, "Data");
    public string ProfileDir => Path.Combine(DataDir, "Profile");
    public string NotesDir => Path.Combine(DataDir, "Notes");
    public string BookmarksDir => Path.Combine(DataDir, "Bookmarks");
    public string SettingsDir => Path.Combine(DataDir, "Settings");
    public string VaultDir => Path.Combine(DataDir, "PasswordVault");
    public string DownloadsDir => Path.Combine(Root, "Downloads");

    public bool UsbPresent => Directory.Exists(Root);

    public static PathManager Detect(string? root = null)
    {
        if (root is not null)
        {
            if (!Path.IsPathFullyQualified(root) || !Directory.Exists(root))
                throw new DirectoryNotFoundException("The Surge workspace folder does not exist.");
            return new PathManager(Path.TrimEndingDirectorySeparator(Path.GetFullPath(root)));
        }
        string exe = Environment.ProcessPath
            ?? throw new InvalidOperationException("Cannot determine the Surge executable location.");
        string dir = Path.GetDirectoryName(exe)
            ?? throw new InvalidOperationException("Cannot determine the Surge USB folder.");
        return new PathManager(Path.GetFullPath(dir));
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

        foreach (string dir in new[] { DataDir, ProfileDir, NotesDir, BookmarksDir, SettingsDir, VaultDir, DownloadsDir })
            Directory.CreateDirectory(dir);
    }

    public StorageInfo GetStorage()
    {
        var drive = new DriveInfo(Path.GetPathRoot(Root)!);
        return new StorageInfo(drive.TotalSize, drive.AvailableFreeSpace);
    }

    public string ToRelative(string fullPath)
    {
        string rel = Path.GetRelativePath(Root, fullPath);
        return rel == "." ? string.Empty : rel.Replace('\\', '/');
    }

    public bool IsProtected(string fullPath)
    {
        // Windows also resolves names with trailing dots/spaces to the same item.
        string rel = string.Join('/', ToRelative(Path.GetFullPath(fullPath)).Split('/')
            .Select(part => part.TrimEnd('.', ' ')));
        // Protect ancestors too: copying, moving or deleting Data would include the vault.
        return rel.Length == 0 || rel.Equals("Data", StringComparison.OrdinalIgnoreCase) ||
            ProtectedEntries.Any(p => rel.Equals(p, StringComparison.OrdinalIgnoreCase) ||
            rel.StartsWith(p + "/", StringComparison.OrdinalIgnoreCase)) ||
            (!rel.Contains('/') && Path.GetExtension(rel).ToLowerInvariant() is ".exe" or ".dll" or ".pak" or ".bin" or ".dat");
    }

    /// Resolves a workspace-relative path, refusing anything that escapes the Surge USB folder.
    public bool TryResolve(string? relative, out string fullPath, out string error)
    {
        fullPath = Root;
        error = string.Empty;

        if (string.IsNullOrWhiteSpace(relative))
            return true;

        if (relative.Contains('\0') || relative.Contains(':') || relative.StartsWith('/') || relative.StartsWith('\\'))
        {
            error = "Only paths inside the Surge USB folder are allowed.";
            return false;
        }

        string[] parts = relative.Split(['/', '\\'], StringSplitOptions.RemoveEmptyEntries);
        if (parts.Any(p => p == ".."))
        {
            error = "Paths may not leave the Surge USB folder.";
            return false;
        }

        string candidate = Path.GetFullPath(Path.Combine(Root, Path.Combine(parts)));
        if (!candidate.Equals(Root, StringComparison.OrdinalIgnoreCase) &&
            !candidate.StartsWith(Root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
        {
            error = "Paths may not leave the Surge USB folder.";
            return false;
        }

        if (ContainsLink(candidate))
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