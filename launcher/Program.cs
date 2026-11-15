using System.Diagnostics;
using System.IO;
using System.Windows;
using SurgePortable.Desktop;

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

            // If running in headless/no-browser CLI mode, handle via console
            if (noBrowser)
            {
                PathManager cliPaths = PathManager.Detect(rootIndex >= 0 ? args[rootIndex + 1] : null);
                cliPaths.IsInstalled = args.Contains("--installed") || File.Exists(Path.Combine(cliPaths.Root, "installed.flag"));
                cliPaths.EnsureDataDirectories();
                using var cliHelper = new LocalHelper(cliPaths, LocalHelper.CreateToken());
                Console.WriteLine("SURGE_URL=" + cliHelper.HomepageUrl);
                Console.ReadLine();
                return 0;
            }

            // --- NATIVE WPF DESKTOP APPLICATION ---
            var app = new System.Windows.Application();

            // 1. Display Surge branding & Splash screen
            var splash = new SplashScreenWindow();
            splash.Show();
            DoEvents();

            // 2. Check USB workspace availability
            splash.UpdateProgress(15, "Checking USB workspace availability…");
            DoEvents();
            Thread.Sleep(200);

            PathManager paths = PathManager.Detect(rootIndex >= 0 ? args[rootIndex + 1] : null);
            paths.IsInstalled = args.Contains("--installed") || File.Exists(Path.Combine(paths.Root, "installed.flag"));

            ValidationResult validation = StartupValidator.Validate(paths, requireBrowser: false);
            if (!validation.Ok)
            {
                splash.Close();
                return Fail(validation.Message, 2);
            }

            using var singleInstance = new Mutex(initiallyOwned: true, paths.MutexName(), out bool isFirstInstance);
            if (!isFirstInstance)
            {
                splash.Close();
                Native.Info("Surge is already running from this drive.\n\nUse the desktop window that is already open, or close it before starting Surge again.");
                return 0;
            }

            // 3. Load configuration & directories
            splash.UpdateProgress(35, "Loading USB workspace configuration…");
            DoEvents();
            paths.EnsureDataDirectories();
            Thread.Sleep(200);

            // 4. Initialize security & local services
            splash.UpdateProgress(55, "Initializing local security services…");
            DoEvents();
            using var helper = new LocalHelper(paths, LocalHelper.CreateToken());
            Thread.Sleep(200);

            // 5. Initialize browser services & profiles
            splash.UpdateProgress(75, "Initializing isolated browser profile…");
            DoEvents();
            string browserProfile = Path.Combine(paths.Data, "BrowserProfile");
            Directory.CreateDirectory(browserProfile);
            Thread.Sleep(200);

            // 6. Prepare desktop workspace, windows, and taskbar
            splash.UpdateProgress(90, "Preparing desktop workspace and taskbar…");
            DoEvents();
            var desktop = new DesktopWindow(paths, helper);
            Thread.Sleep(250);

            // 7. Completed! Show desktop and close splash
            splash.UpdateProgress(100, "Starting Surge Portable…");
            DoEvents();
            desktop.Show();
            splash.Close();

            // Run WPF application loop
            return app.Run(desktop);
        }
        catch (Exception ex)
        {
            return Fail("Surge could not start:\n\n" + ex.Message, 1);
        }
    }

    private static void DoEvents()
    {
        var frame = new System.Windows.Threading.DispatcherFrame();
        System.Windows.Threading.Dispatcher.CurrentDispatcher.BeginInvoke(
            System.Windows.Threading.DispatcherPriority.Background,
            new System.Windows.Threading.DispatcherOperationCallback(ExitFrame),
            frame);
        System.Windows.Threading.Dispatcher.PushFrame(frame);
    }

    private static object? ExitFrame(object frame)
    {
        ((System.Windows.Threading.DispatcherFrame)frame).Continue = false;
        return null;
    }

    private static int Fail(string message, int exitCode)
    {
        Console.Error.WriteLine(message);
        Native.Error(message);
        return exitCode;
    }
}
