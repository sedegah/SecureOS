using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace SurgePortable.Desktop;

internal static class WindowsHelloService
{
    private static bool? isAvailableCache = null;

    public static bool IsAvailable()
    {
        if (isAvailableCache.HasValue) return isAvailableCache.Value;
        try
        {
            isAvailableCache = Environment.OSVersion.Version.Major >= 10;
        }
        catch
        {
            isAvailableCache = false;
        }
        return isAvailableCache.Value;
    }

    /// <summary>
    /// Protects master password with Windows DPAPI (tied to this local machine and user profile).
    /// </summary>
    public static byte[] ProtectPassword(string password)
    {
        byte[] plaintext = Encoding.UTF8.GetBytes(password);
        byte[] entropy = Encoding.UTF8.GetBytes("SurgeVault-Hello-Salt");
        return ProtectedData.Protect(plaintext, entropy, DataProtectionScope.CurrentUser);
    }

    /// <summary>
    /// Unwraps the master password from Windows DPAPI.
    /// </summary>
    public static string? UnprotectPassword(byte[] encrypted)
    {
        try
        {
            byte[] entropy = Encoding.UTF8.GetBytes("SurgeVault-Hello-Salt");
            byte[] decrypted = ProtectedData.Unprotect(encrypted, entropy, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(decrypted);
        }
        catch
        {
            return null;
        }
    }

    public static void ProtectPassword(PathManager paths, string password)
    {
        try
        {
            Directory.CreateDirectory(paths.SettingsDir);
            byte[] enc = ProtectPassword(password);
            File.WriteAllBytes(Path.Combine(paths.SettingsDir, "hello.bin"), enc);
        }
        catch { }
    }

    public static string? UnprotectPassword(PathManager paths)
    {
        try
        {
            string file = Path.Combine(paths.SettingsDir, "hello.bin");
            if (File.Exists(file))
            {
                byte[] enc = File.ReadAllBytes(file);
                return UnprotectPassword(enc);
            }
        }
        catch { }
        return null;
    }
}
