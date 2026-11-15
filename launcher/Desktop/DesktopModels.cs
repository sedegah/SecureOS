using System.IO;
using System.Text.Json;
using System.Windows.Media;

namespace SurgePortable.Desktop;

internal enum ShortcutSize
{
    Small = 36,
    Medium = 48,
    Large = 64
}

internal sealed class DesktopShortcut
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public string AppId { get; set; } = "";
    public double PositionX { get; set; } = -1;
    public double PositionY { get; set; } = -1;
    public double X { get => PositionX; set => PositionX = value; }
    public double Y { get => PositionY; set => PositionY = value; }
    public string ColorHex { get; set; } = "#3B82F6";
}

internal sealed class DesktopSettings
{
    public string WallpaperId { get; set; } = "navy-aurora";
    public string Wallpaper { get => WallpaperId; set => WallpaperId = value; }
    public string CustomWallpaperPath { get; set; } = "";
    public string AccentColor { get; set; } = "#3B82F6";
    public string AccentColorHex { get => AccentColor; set => AccentColor = value; }
    public bool Use24HourClock { get; set; } = false;
    public int DesktopIconSize { get; set; } = 48;
    public ShortcutSize IconSize { get => (ShortcutSize)DesktopIconSize; set => DesktopIconSize = (int)value; }
    public bool EnableBiometrics { get; set; } = true;
    public bool WindowsHelloEnabled { get => EnableBiometrics; set => EnableBiometrics = value; }
    public List<string> PinnedApps { get; set; } = ["browser", "files", "notes", "downloads", "vault", "vpn", "settings"];
    public List<DesktopShortcut> Shortcuts { get; set; } = [];

    public static DesktopSettings Load(PathManager paths)
    {
        string file = Path.Combine(paths.SettingsDir, "desktop.json");
        try
        {
            if (File.Exists(file))
            {
                string json = File.ReadAllText(file);
                var loaded = JsonSerializer.Deserialize<DesktopSettings>(json);
                if (loaded is not null && loaded.Shortcuts.Count > 0) return loaded;
            }
        }
        catch { }

        var def = CreateDefaults();
        def.Save(paths);
        return def;
    }

    public void Save(PathManager paths)
    {
        try
        {
            Directory.CreateDirectory(paths.SettingsDir);
            string file = Path.Combine(paths.SettingsDir, "desktop.json");
            File.WriteAllText(file, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { }
    }

    public static DesktopSettings CreateDefaults()
    {
        return new DesktopSettings
        {
            Shortcuts =
            [
                new DesktopShortcut { Id = "browser", Title = "Surge Browser", AppId = "browser", PositionX = -1, PositionY = -1, ColorHex = "#3B82F6" },
                new DesktopShortcut { Id = "files", Title = "My Files", AppId = "files", PositionX = -1, PositionY = -1, ColorHex = "#0EA5E9" },
                new DesktopShortcut { Id = "notes", Title = "Notes", AppId = "notes", PositionX = -1, PositionY = -1, ColorHex = "#10B981" },
                new DesktopShortcut { Id = "downloads", Title = "Downloads", AppId = "downloads", PositionX = -1, PositionY = -1, ColorHex = "#6366F1" },
                new DesktopShortcut { Id = "vault", Title = "Password Vault", AppId = "vault", PositionX = -1, PositionY = -1, ColorHex = "#F59E0B" },
                new DesktopShortcut { Id = "vpn", Title = "VPN & Proxy", AppId = "vpn", PositionX = -1, PositionY = -1, ColorHex = "#8B5CF6" },
                new DesktopShortcut { Id = "settings", Title = "Settings", AppId = "settings", PositionX = -1, PositionY = -1, ColorHex = "#64748B" },
            ]
        };
    }
}

internal sealed class NotificationItem
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Title { get; set; } = "";
    public string Message { get; set; } = "";
    public DateTime Time { get; set; } = DateTime.Now;
    public string Type { get; set; } = "info"; // info, warning, error, success
}

internal static class DeskColors
{
    private static SolidColorBrush B(byte r, byte g, byte b, byte a = 255)
    {
        var brush = new SolidColorBrush(Color.FromArgb(a, r, g, b));
        brush.Freeze();
        return brush;
    }

    public static readonly SolidColorBrush NavyDark = B(8, 13, 26);
    public static readonly SolidColorBrush NavySurface = B(14, 23, 46);
    public static readonly SolidColorBrush NavySurfaceHover = B(26, 40, 75);
    public static readonly SolidColorBrush NavyCard = B(20, 32, 60);
    public static readonly SolidColorBrush NavyBorder = B(30, 48, 88);
    public static readonly SolidColorBrush AccentBlue = B(37, 99, 235);
    public static readonly SolidColorBrush CyanGlow = B(6, 182, 212);
    public static readonly SolidColorBrush TextPrimary = B(248, 250, 252);
    public static readonly SolidColorBrush TextMuted = B(148, 163, 184);
    public static readonly SolidColorBrush AmberWarning = B(245, 158, 11);
    public static readonly SolidColorBrush EmeraldSuccess = B(16, 185, 129);
    public static readonly SolidColorBrush DangerRed = B(239, 68, 68);
}
