using System.Text.Json;
using System.Windows.Media;

namespace SurgePortable.Desktop;

internal enum ShortcutSize
{
    Small = 48,
    Medium = 64,
    Large = 80
}

internal sealed class DesktopShortcut
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public string AppId { get; set; } = "";
    public double X { get; set; }
    public double Y { get; set; }
    public string ColorHex { get; set; } = "#2563EB";
}

internal sealed class DesktopSettings
{
    public string Wallpaper { get; set; } = "SurgeNavy";
    public string CustomWallpaperPath { get; set; } = "";
    public string AccentColorHex { get; set; } = "#2563EB";
    public bool Use24HourClock { get; set; } = false;
    public ShortcutSize IconSize { get; set; } = ShortcutSize.Medium;
    public bool WindowsHelloEnabled { get; set; } = true;
    public List<string> PinnedApps { get; set; } = ["browser", "files", "notes", "downloads", "vault", "vpn", "settings"];
    public List<DesktopShortcut> Shortcuts { get; set; } = [];

    public static DesktopSettings Load(PathManager paths)
    {
        string file = Path.Combine(paths.Data, "Settings", "desktop.json");
        try
        {
            if (File.Exists(file))
            {
                string json = File.ReadAllText(file);
                var loaded = JsonSerializer.Deserialize<DesktopSettings>(json);
                if (loaded is not null) return loaded;
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
            string dir = Path.Combine(paths.Data, "Settings");
            Directory.CreateDirectory(dir);
            string file = Path.Combine(dir, "desktop.json");
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
                new DesktopShortcut { Id = "s-browser", Title = "Surge Browser", AppId = "browser", X = 20, Y = 20, ColorHex = "#3B82F6" },
                new DesktopShortcut { Id = "s-files", Title = "My Files", AppId = "files", X = 20, Y = 115, ColorHex = "#0EA5E9" },
                new DesktopShortcut { Id = "s-notes", Title = "Notes", AppId = "notes", X = 20, Y = 210, ColorHex = "#10B981" },
                new DesktopShortcut { Id = "s-downloads", Title = "Downloads", AppId = "downloads", X = 20, Y = 305, ColorHex = "#6366F1" },
                new DesktopShortcut { Id = "s-vault", Title = "Password Vault", AppId = "vault", X = 20, Y = 400, ColorHex = "#F59E0B" },
                new DesktopShortcut { Id = "s-vpn", Title = "Browser Proxy", AppId = "vpn", X = 20, Y = 495, ColorHex = "#8B5CF6" },
                new DesktopShortcut { Id = "s-settings", Title = "Settings", AppId = "settings", X = 20, Y = 590, ColorHex = "#64748B" },
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
    public static readonly Color NavyDark = Color.FromRgb(8, 13, 26);
    public static readonly Color NavySurface = Color.FromRgb(14, 23, 46);
    public static readonly Color NavyCard = Color.FromRgb(20, 32, 60);
    public static readonly Color AccentBlue = Color.FromRgb(37, 99, 235);
    public static readonly Color AccentCyan = Color.FromRgb(6, 182, 212);
    public static readonly Color TaskbarBackground = Color.FromArgb(235, 11, 18, 36);
    public static readonly Color BorderSubtle = Color.FromArgb(50, 255, 255, 255);
    public static readonly Color BorderStrong = Color.FromArgb(90, 255, 255, 255);
    public static readonly Color TextPrimary = Color.FromRgb(248, 250, 252);
    public static readonly Color TextSecondary = Color.FromRgb(148, 163, 184);

    public static SolidColorBrush Brush(Color c)
    {
        var b = new SolidColorBrush(c);
        b.Freeze();
        return b;
    }
}
