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
            paths.IsInstalled = args.Contains("--installed") || File.Exists(Path.Combine(paths.Root, "installed.flag"));
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
            {
                Console.WriteLine("SURGE_URL=" + helper.HomepageUrl);
            }
            else if (validation.BrowserExecutable is not null)
            {
                browser = BrowserLauncher.Launch(paths, validation.BrowserExecutable, helper.Policy, helper.HomepageUrl);
            }
            else
            {

                Process.Start(new ProcessStartInfo(helper.HomepageUrl) { UseShellExecute = true });
            }

            helper.BrowserRunning = browser is not null || !noBrowser;
            RunUntilBrowserCloses(helper, ref browser, paths, validation.BrowserExecutable, noBrowser);

            if (browser is not null && browser.HasExited && browser.ExitCode != 0)
                return Fail($"Firefox closed unexpectedly (exit code {browser.ExitCode}).\n\nCheck that the Browser folder on the USB drive is complete, then start Surge again.", 3);

            return 0;
        }
        catch (Exception ex)
        {
            return Fail("Surge could not start:\n\n" + ex.Message, 1);
        }
    }

    private static void RunUntilBrowserCloses(LocalHelper helper, ref Process? browser, PathManager paths, string? browserExecutable, bool noBrowser)
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
            else if (!noBrowser)
            {

                if (DateTime.UtcNow.Ticks - helper.LastHeartbeatTicks > TimeSpan.FromMinutes(2).Ticks)
                    return;
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
