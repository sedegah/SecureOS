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
            int rootIndex = Array.IndexOf(args, "--root");
            if (rootIndex >= 0 && (!noBrowser || rootIndex + 1 >= args.Length))
                return Fail("A workspace root is supported only with --no-browser and needs a path.", 2);
            PathManager paths = PathManager.Detect(rootIndex >= 0 ? args[rootIndex + 1] : null);
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
                browser = BrowserLauncher.Launch(paths, validation.BrowserExecutable!, helper.Policy, helper.HomepageUrl);

            helper.BrowserRunning = browser is not null;
            RunUntilBrowserCloses(helper, ref browser, paths, validation.BrowserExecutable);

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
    /// A VPN change restarts Firefox in place so the helper, its port and its token survive.
    private static void RunUntilBrowserCloses(LocalHelper helper, ref Process? browser, PathManager paths, string? browserExecutable)
    {
        DateTime? browserClosedAt = null;

        while (true)
        {
            if (helper.RestartRequested)
            {
                helper.ClearRestart();
                if (browser is not null && browserExecutable is not null)
                {
                    helper.BrowserRunning = false;
                    CloseBrowser(browser);
                    browser = BrowserLauncher.Launch(paths, browserExecutable, helper.Policy, helper.HomepageUrl);
                    helper.BrowserRunning = browser is not null;
                    browserClosedAt = null;
                    continue;
                }
            }

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

    private static void CloseBrowser(Process browser)
    {
        try
        {
            if (!browser.HasExited)
            {
                browser.CloseMainWindow();
                if (!browser.WaitForExit(8000))
                    browser.Kill(entireProcessTree: true);
            }
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            // Already gone.
        }
        finally
        {
            browser.Dispose();
        }
    }

    private static int Fail(string message, int exitCode)
    {
        Console.Error.WriteLine(message);
        Native.Error(message);
        return exitCode;
    }
}