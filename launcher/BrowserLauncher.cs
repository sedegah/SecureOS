using System.Diagnostics;
using System.Text;

namespace SurgePortable;

internal static class BrowserLauncher
{
    /// Firefox reads user.js at startup, so runtime-resolved USB paths are written on every launch
    /// instead of being stored as absolute paths in Surge's own settings.
    public static void WritePortablePreferences(PathManager paths, BrowserPolicy policy, string homepageUrl)
    {
        Directory.CreateDirectory(paths.ProfileDir);

        var prefs = new List<(string Key, string Value)>
        {
            ("browser.download.dir", paths.DownloadsDir),
            ("browser.download.folderList", "2"),
            ("browser.download.useDownloadDir", "true"),
            ("browser.download.start_downloads_in_tmp_dir", "false"),
            ("browser.shell.checkDefaultBrowser", "false"),
            ("browser.aboutwelcome.enabled", "false"),
            ("startup.homepage_welcome_url", string.Empty),
            ("startup.homepage_welcome_url.additional", string.Empty),
            ("startup.homepage_override_url", string.Empty),
            ("datareporting.policy.firstRunURL", string.Empty),
            ("browser.messaging-system.whatsNewPanel.enabled", "false"),
            ("signon.rememberSignons", "false"),
            ("signon.autofillForms", "false"),
            ("signon.generation.enabled", "false"),
            ("signon.management.page.breach-alerts.enabled", "false"),
            ("identity.fxaccounts.enabled", "false"),
            ("app.update.auto", "false"),
            ("app.update.staging.enabled", "false"),
            ("browser.cache.disk.enable", "false"),
            ("browser.cache.memory.enable", "true"),
            ("browser.sessionstore.interval", "60000"),
            ("toolkit.winRegisterApplicationRestart", "false"),
            ("datareporting.healthreport.uploadEnabled", "false"),
            ("datareporting.policy.dataSubmissionEnabled", "false"),
            ("toolkit.telemetry.unified", "false"),
            ("toolkit.telemetry.enabled", "false"),
            ("toolkit.telemetry.archive.enabled", "false"),
            ("browser.newtabpage.activity-stream.feeds.telemetry", "false"),
            ("browser.newtabpage.activity-stream.telemetry", "false"),
            ("browser.ping-centre.telemetry", "false"),
        };

        prefs.AddRange(policy.Preferences(homepageUrl));
        policy.WritePolicies(paths);

        var text = new StringBuilder("// Managed by Surge Portable. Rewritten on every launch; edit Data/Settings instead.\n");
        foreach ((string key, string value) in prefs)
        {
            bool literal = value is "true" or "false" || (value.Length > 0 && value.All(char.IsDigit));
            string rendered = literal ? value : "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
            text.Append("user_pref(\"").Append(key).Append("\", ").Append(rendered).Append(");\n");
        }

        File.WriteAllText(Path.Combine(paths.ProfileDir, "user.js"), text.ToString(), new UTF8Encoding(false));
    }

    public static Process Launch(PathManager paths, string browserExecutable, BrowserPolicy policy, string homepageUrl)
    {
        WritePortablePreferences(paths, policy, homepageUrl);

        var info = new ProcessStartInfo(browserExecutable)
        {
            WorkingDirectory = Path.GetDirectoryName(browserExecutable)!,
            UseShellExecute = false,
        };
        info.ArgumentList.Add("-no-remote");
        info.ArgumentList.Add("-profile");
        info.ArgumentList.Add(paths.ProfileDir);
        info.ArgumentList.Add(homepageUrl);
        info.Environment["MOZ_CRASHREPORTER_DISABLE"] = "1";

        return Process.Start(info)
            ?? throw new InvalidOperationException("Firefox could not be started.");
    }
}