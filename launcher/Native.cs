using System.Runtime.InteropServices;

namespace SurgePortable;

internal static class Native
{
    private const uint MbOk = 0x0;
    private const uint MbIconError = 0x10;
    private const uint MbIconInformation = 0x40;
    private const uint MbSetForeground = 0x10000;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

    public static void Error(string message) =>
        MessageBoxW(IntPtr.Zero, message, "Surge Portable", MbOk | MbIconError | MbSetForeground);

    public static void Info(string message) =>
        MessageBoxW(IntPtr.Zero, message, "Surge Portable", MbOk | MbIconInformation | MbSetForeground);
}
