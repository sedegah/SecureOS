using System.Diagnostics;

namespace SurgePortable;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        bool noBrowser = args.Contains("--no-browser");

        try
        {
            PathManager paths = PathManager.Detect();
            ValidationResult validation = StartupValidator.Validate(paths, requireBrowser: !noBrowser);
            if (!validation.Ok)
                return Fail(validation.Message, 2);

            using var singleInstance = new Mutex(initiallyOwned: true, paths.MutexName(), out bool isFirstInstance);
            if (!isFirstInstance)
            {
                Native.Info("Surge is already running from this drive.\n\nUse the Firefox window that is already open, or close it before starting Surge again.");
                return 0;
            }

            paths.EnsureDataDirectories();
            using var helper = new LocalHelper(paths, LocalHelper.CreateToken());

            Process? browser = null;
            if (noBrowser)
                Console.WriteLine("SURGE_URL=" + helper.HomepageUrl);
            else
                browser = BrowserLauncher.Launch(paths, validation.BrowserExecutable!, helper.HomepageUrl);

            RunUntilBrowserCloses(helper, browser);

            if (browser is not null && browser.HasExited && browser.ExitCode != 0)
                return Fail($"Firefox closed unexpectedly (exit code {browser.ExitCode}).\n\nCheck that the Browser folder on the USB drive is complete, then start Surge again.", 3);

            return 0;
        }
        catch (Exception ex)
        {
            return Fail("Surge could not start:\n\n" + ex.Message, 1);
        }
    }

    /// The helper stays alive only while Firefox is open, because native USB file operations
    /// genuinely need it. It exits with the browser and leaves nothing running when idle.
    private static void RunUntilBrowserCloses(LocalHelper helper, Process? browser)
    {
        DateTime? browserClosedAt = null;

        while (true)
        {
            if (browser is not null)
            {
                if (browser.HasExited)
                {
                    browserClosedAt ??= DateTime.UtcNow;
                    if (DateTime.UtcNow - browserClosedAt > TimeSpan.FromSeconds(5))
                        return;
                }
                else
                {
                    browserClosedAt = null;
                }
            }

            Thread.Sleep(1000);
        }
    }

    private static int Fail(string message, int exitCode)
    {
        Console.Error.WriteLine(message);
        Native.Error(message);
        return exitCode;
    }
}