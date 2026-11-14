namespace SurgePortable;

internal sealed record ValidationResult(bool Ok, string Message, string? BrowserExecutable)
{
    public static ValidationResult Success(string? browser) => new(true, string.Empty, browser);
    public static ValidationResult Failure(string message) => new(false, message, null);
}

internal static class StartupValidator
{
    private static readonly string[] BrowserCandidates =
    [
        @"FirefoxPortable\App\Firefox64\firefox.exe",
        @"FirefoxPortable\App\Firefox\firefox.exe",
        @"Firefox\firefox.exe",
    ];

    public static ValidationResult Validate(PathManager paths, bool requireBrowser)
    {
        if (!paths.UsbPresent)
            return ValidationResult.Failure(
                $"The Surge folder could not be found at:\n{paths.Root}\n\nReconnect the USB drive and start Surge.exe again.");

        string homepage = Path.Combine(paths.InterfaceDir, "index.html");
        if (!File.Exists(homepage))
            return ValidationResult.Failure(
                $"The Surge interface is missing or damaged:\n{homepage}\n\nRestore the Interface folder from your Surge backup or reinstall Surge on the USB drive.");

        if (!requireBrowser)
            return ValidationResult.Success(null);

        string? browser = FindBrowser(paths);
        if (browser is null)
        {
            string expected = string.Join("\n", BrowserCandidates.Select(c => Path.Combine(paths.BrowserDir, c)));
            return ValidationResult.Failure(
                "Firefox could not be found on this USB drive. Expected one of:\n\n" + expected +
                "\n\nRun packaging\\package.ps1 to add the browser, or copy a Firefox Portable distribution into the Browser folder.");
        }

        return ValidationResult.Success(browser);
    }

    public static string? FindBrowser(PathManager paths) =>
        BrowserCandidates
            .Select(c => Path.Combine(paths.BrowserDir, c))
            .FirstOrDefault(File.Exists);
}