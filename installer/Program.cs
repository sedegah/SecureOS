using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

namespace SurgeInstaller;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();

#if SCREENSHOT
        ScreenshotHarness.Run(args);
#else
        Run(args);
#endif
    }

    private static void Run(string[] args)
    {
        if (args.Contains("--uninstall"))
        {
            RunUninstall();
            return;
        }

        string? updateDirectory = null;
        int waitPid = 0;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--update-directory" && i + 1 < args.Length)
                updateDirectory = args[++i];
            else if (args[i] == "--wait-pid" && i + 1 < args.Length &&
                     !int.TryParse(args[++i], out waitPid))
            {
                MessageBox.Show("Invalid update process identifier.", "Surge Setup",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
        }

        if (updateDirectory is not null)
        {
            updateDirectory = Path.GetFullPath(updateDirectory);
            if (!Directory.Exists(updateDirectory) ||
                !File.Exists(Path.Combine(updateDirectory, "Surge.exe")) ||
                !File.Exists(Path.Combine(updateDirectory, "installed.flag")))
            {
                MessageBox.Show("The selected folder is not an existing installed Surge application.",
                    "Surge Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            if (waitPid > 0)
            {
                try
                {
                    using var runningApp = Process.GetProcessById(waitPid);
                    if (!runningApp.WaitForExit(120000))
                    {
                        MessageBox.Show("Surge did not close in time. Close Surge and run the update again.",
                            "Surge Setup", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                        return;
                    }
                }
                catch (ArgumentException) { }
                catch (InvalidOperationException) { }
            }
        }

        Application.Run(new InstallerWizard(updateDirectory));
    }

    private static void RunUninstall()
    {
        var result = MessageBox.Show(
            "Are you sure you want to completely uninstall Surge Workspace & Browser?",
            "Uninstall Surge",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question);

        if (result != DialogResult.Yes)
            return;

        try
        {

            string desktopShortcut = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Surge.lnk");
            if (File.Exists(desktopShortcut)) File.Delete(desktopShortcut);

            string startMenuDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");
            string startShortcut = Path.Combine(startMenuDir, "Surge.lnk");
            if (File.Exists(startShortcut)) File.Delete(startShortcut);

            using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall", writable: true))
            {
                key?.DeleteSubKeyTree("Surge", throwOnMissingSubKey: false);
            }

            string appDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            string batchPath = Path.Combine(Path.GetTempPath(), "surge_uninst_" + Guid.NewGuid().ToString("N") + ".bat");
            string batchContent = $@"@echo off
timeout /t 2 /nobreak > nul
rd /s /q ""{appDir}""
del ""{batchPath}""
";
            File.WriteAllText(batchPath, batchContent);
            Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c \"{batchPath}\"",
                CreateNoWindow = true,
                UseShellExecute = false
            });

            MessageBox.Show("Surge has been successfully uninstalled from your computer.", "Uninstall Surge", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show("Could not complete uninstallation:\n" + ex.Message, "Uninstall Surge", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}

/// <summary>
/// Design tokens and drawing primitives for the wizard.
///
/// The chrome follows the DeepSeek Harness installer: a near-white rail closed
/// by a hairline, near-black ink on white, generous whitespace, and exactly one
/// thin accent rule. The identity inside it is Surge's own — its logo and blue.
/// </summary>
internal static class Ui
{
    public static float ScaleFactor = 1f;

    public static readonly Color Accent = Color.FromArgb(0x15, 0x46, 0xE6);
    public static readonly Color AccentDeep = Color.FromArgb(0x0F, 0x36, 0xB4);
    public static readonly Color AccentSoft = Color.FromArgb(0xED, 0xF2, 0xFE);
    public static readonly Color AccentHover = Color.FromArgb(0x11, 0x3F, 0xD2);
    public static readonly Color Ink = Color.FromArgb(0x0B, 0x1B, 0x3A);
    public static readonly Color Muted = Color.FromArgb(0x5A, 0x64, 0x72);
    public static readonly Color Faint = Color.FromArgb(0x8A, 0x93, 0xA3);
    public static readonly Color Hairline = Color.FromArgb(0xE6, 0xE9, 0xEF);
    public static readonly Color RailFill = Color.FromArgb(0xF9, 0xFA, 0xFB);
    public static readonly Color RailLine = Color.FromArgb(0xE8, 0xEB, 0xF0);
    public static readonly Color FieldBorder = Color.FromArgb(0xD7, 0xDD, 0xE8);
    public static readonly Color PlateFill = Color.FromArgb(0xF7, 0xF9, 0xFC);
    public static readonly Color Surface = Color.White;
    public static readonly Color Track = Color.FromArgb(0xED, 0xF0, 0xF5);
    public static readonly Color Danger = Color.FromArgb(0xC4, 0x2B, 0x1C);
    public static readonly Color DisabledFill = Color.FromArgb(0xB9, 0xC6, 0xE8);

    private static readonly string UiFamily = ResolveFamily("Segoe UI Variable Text", "Segoe UI");
    private static readonly string SemiFamily = ResolveFamily("Segoe UI Variable Display Semibold", "Segoe UI Semibold", "Segoe UI");

    public static Font Display(float size) => new(SemiFamily, size, FontStyle.Regular, GraphicsUnit.Point);
    public static Font Semi(float size) => new(SemiFamily, size, FontStyle.Regular, GraphicsUnit.Point);
    public static Font Body(float size) => new(UiFamily, size, FontStyle.Regular, GraphicsUnit.Point);

    private static string ResolveFamily(params string[] candidates)
    {
        try
        {
            using var installed = new InstalledFontCollection();
            var names = installed.Families.Select(f => f.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var candidate in candidates)
                if (names.Contains(candidate))
                    return candidate;
        }
        catch { }
        return "Segoe UI";
    }

    public static int S(int value) => (int)Math.Round(value * ScaleFactor);

    public static float S(float value) => value * ScaleFactor;

    public static GraphicsPath Round(RectangleF bounds, float radius)
    {
        var path = new GraphicsPath();
        if (radius <= 0f)
        {
            path.AddRectangle(bounds);
            return path;
        }
        float d = Math.Min(radius * 2f, Math.Min(bounds.Width, bounds.Height));
        path.AddArc(bounds.X, bounds.Y, d, d, 180, 90);
        path.AddArc(bounds.Right - d, bounds.Y, d, d, 270, 90);
        path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
        path.AddArc(bounds.X, bounds.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    /// <summary>Draws an image clipped to a rounded square over a soft plate.</summary>
    public static void DrawRoundedImage(Graphics g, Image image, RectangleF bounds, float radius, Color plate)
    {
        using var path = Round(bounds, radius);
        using (var plateBrush = new SolidBrush(plate))
            g.FillPath(plateBrush, path);

        var state = g.Save();
        g.SetClip(path);
        float ratio = Math.Min(bounds.Width / image.Width, bounds.Height / image.Height);
        float w = image.Width * ratio;
        float h = image.Height * ratio;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.DrawImage(image, bounds.X + (bounds.Width - w) / 2f, bounds.Y + (bounds.Height - h) / 2f, w, h);
        g.Restore(state);
    }

    /// <summary>GDI text with mnemonics off, so ampersands render literally.</summary>
    public static void Text(Graphics g, string text, Font font, Color color, Rectangle bounds,
        TextFormatFlags flags = TextFormatFlags.Left | TextFormatFlags.Top)
    {
        TextRenderer.DrawText(g, text, font, bounds, color,
            flags | TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
    }
}

internal enum ButtonKind
{
    Primary,
    Secondary,
    Ghost
}

/// <summary>A flat, rounded button painted by hand so it matches the wizard chrome.</summary>
internal sealed class FlatButton : Button
{
    private bool hovering;
    private bool pressing;

    [System.ComponentModel.Browsable(false)]
    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public ButtonKind Kind { get; set; } = ButtonKind.Secondary;

    public FlatButton()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                 ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        FlatStyle = FlatStyle.Flat;
        FlatAppearance.BorderSize = 0;
        UseVisualStyleBackColor = false;
        BackColor = Ui.Surface;
        Height = 38;
    }

    protected override void OnMouseEnter(EventArgs e) { hovering = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hovering = false; pressing = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnMouseDown(MouseEventArgs e) { pressing = true; Invalidate(); base.OnMouseDown(e); }
    protected override void OnMouseUp(MouseEventArgs e) { pressing = false; Invalidate(); base.OnMouseUp(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        g.Clear(Parent?.BackColor ?? Ui.Surface);

        var bounds = new RectangleF(0.5f, 0.5f, Width - 1f, Height - 1f);
        using var path = Ui.Round(bounds, Ui.S(8f));

        Color fill, text, border = Color.Empty;
        switch (Kind)
        {
            case ButtonKind.Primary:
                fill = !Enabled ? Ui.DisabledFill
                    : pressing ? Ui.AccentDeep
                    : hovering ? Ui.AccentHover
                    : Ui.Accent;
                text = Color.White;
                break;
            case ButtonKind.Ghost:
                fill = pressing ? Ui.Track : hovering ? Ui.RailFill : Ui.Surface;
                text = Enabled ? Ui.Muted : Ui.Faint;
                break;
            default:
                fill = !Enabled ? Ui.RailFill : pressing ? Ui.Track : hovering ? Color.FromArgb(0xF4, 0xF6, 0xFA) : Ui.Surface;
                text = Enabled ? Ui.Ink : Ui.Faint;
                border = Enabled ? Ui.FieldBorder : Ui.Hairline;
                break;
        }

        using (var brush = new SolidBrush(fill))
            g.FillPath(brush, path);
        if (border != Color.Empty)
        {
            using var pen = new Pen(border);
            g.DrawPath(pen, path);
        }

        if (Focused && ShowFocusCues)
        {
            using var focusPath = Ui.Round(RectangleF.Inflate(bounds, -Ui.S(3f), -Ui.S(3f)), Ui.S(6f));
            using var pen = new Pen(Color.FromArgb(90, Ui.Accent));
            g.DrawPath(pen, focusPath);
        }

        Ui.Text(g, Text, Font, text, new Rectangle(0, 0, Width, Height),
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
    }
}

/// <summary>The left rail: logo, wordmark, accent rule, step ticks and version.</summary>
internal sealed class Sidebar : Panel
{
    private readonly Image? logo;
    private readonly string version;

    [System.ComponentModel.Browsable(false)]
    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public int Step { get; set; }

    [System.ComponentModel.Browsable(false)]
    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public int StepCount { get; set; } = 4;

    public Sidebar(Image? logo, string version)
    {
        this.logo = logo;
        this.version = version;
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                 ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        BackColor = Ui.RailFill;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        g.Clear(Ui.RailFill);

        using (var pen = new Pen(Ui.RailLine))
            g.DrawLine(pen, Width - 1, 0, Width - 1, Height);

        int left = Ui.S(28);
        var logoBounds = new RectangleF(left, Ui.S(34), Ui.S(56), Ui.S(56));
        if (logo is not null)
            Ui.DrawRoundedImage(g, logo, logoBounds, Ui.S(14f), Color.White);
        else
        {
            using var plate = Ui.Round(logoBounds, Ui.S(14f));
            using var brush = new SolidBrush(Ui.AccentSoft);
            g.FillPath(brush, plate);
        }

        using (var wordmark = Ui.Semi(15f))
            Ui.Text(g, "Surge", wordmark, Ui.Ink, new Rectangle(left, Ui.S(102), Width - left * 2, Ui.S(26)));
        using (var caption = Ui.Body(8.5f))
            Ui.Text(g, "Workspace & Browser", caption, Ui.Faint, new Rectangle(left, Ui.S(128), Width - left * 2, Ui.S(18)));

        var rule = new RectangleF(left, Ui.S(156), Ui.S(34), Ui.S(3));
        using (var rulePath = Ui.Round(rule, Ui.S(1.5f)))
        using (var brush = new SolidBrush(Ui.Accent))
            g.FillPath(brush, rulePath);

        // A quiet progress ledger at the foot of the rail.
        int tickTop = Height - Ui.S(66);
        int tickWidth = Ui.S(34);
        int gap = Ui.S(6);
        for (int i = 0; i < StepCount; i++)
        {
            var tick = new RectangleF(left + i * (tickWidth + gap), tickTop, tickWidth, Ui.S(3));
            using var tickPath = Ui.Round(tick, Ui.S(1.5f));
            using var brush = new SolidBrush(i <= Step ? Ui.Accent : Ui.Track);
            g.FillPath(brush, tickPath);
        }

        using (var meta = Ui.Body(8.5f))
        {
            Ui.Text(g, $"Step {Math.Min(Step + 1, StepCount)} of {StepCount}", meta, Ui.Muted,
                new Rectangle(left, Height - Ui.S(46), Width - left * 2, Ui.S(16)));
            Ui.Text(g, version, meta, Color.FromArgb(0xB0, 0xB7, 0xC3),
                new Rectangle(left, Height - Ui.S(28), Width - left * 2, Ui.S(16)));
        }
    }
}

/// <summary>A rounded, hairline-bordered text field with a focus ring.</summary>
internal sealed class PathField : Panel
{
    public TextBox Input { get; } = new();
    private bool focused;

    public PathField()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                 ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        BackColor = Ui.Surface;

        Input.BorderStyle = BorderStyle.None;
        Input.BackColor = Ui.Surface;
        Input.ForeColor = Ui.Ink;
        Input.Font = Ui.Body(10f);
        Input.GotFocus += (s, e) => { focused = true; Invalidate(); };
        Input.LostFocus += (s, e) => { focused = false; Invalidate(); };
        Controls.Add(Input);
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        Input.SetBounds(Ui.S(14), (Height - Input.PreferredHeight) / 2, Width - Ui.S(28), Input.PreferredHeight);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Parent?.BackColor ?? Ui.Surface);

        var bounds = new RectangleF(0.5f, 0.5f, Width - 1f, Height - 1f);
        using var path = Ui.Round(bounds, Ui.S(8f));
        using (var brush = new SolidBrush(Enabled ? Ui.Surface : Ui.RailFill))
            g.FillPath(brush, path);

        if (focused)
        {
            using var glow = new Pen(Color.FromArgb(40, Ui.Accent), Ui.S(3f));
            g.DrawPath(glow, path);
        }
        using var pen = new Pen(focused ? Ui.Accent : Ui.FieldBorder);
        g.DrawPath(pen, path);
    }
}

/// <summary>A check row: rounded box, title, and an optional secondary line.</summary>
internal sealed class TaskCheck : CheckBox
{
    private bool hovering;

    [System.ComponentModel.Browsable(false)]
    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public string Description { get; set; } = string.Empty;

    public TaskCheck()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                 ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        AutoSize = false;
        BackColor = Ui.Surface;
        Cursor = Cursors.Hand;
    }

    protected override void OnMouseEnter(EventArgs e) { hovering = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hovering = false; Invalidate(); base.OnMouseLeave(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        g.Clear(Ui.Surface);

        int boxSize = Ui.S(18);
        int boxTop = string.IsNullOrEmpty(Description) ? (Height - boxSize) / 2 : Ui.S(12);
        var box = new RectangleF(Ui.S(1), boxTop, boxSize, boxSize);

        if (hovering && Enabled)
        {
            using var hoverPath = Ui.Round(new RectangleF(0, 0, Width, Height), Ui.S(8f));
            using var hoverBrush = new SolidBrush(Color.FromArgb(0xF7, 0xF9, 0xFC));
            g.FillPath(hoverBrush, hoverPath);
        }

        using (var path = Ui.Round(box, Ui.S(5f)))
        {
            if (Checked)
            {
                using var brush = new SolidBrush(Enabled ? Ui.Accent : Ui.DisabledFill);
                g.FillPath(brush, path);
            }
            else
            {
                using var brush = new SolidBrush(Enabled ? Ui.Surface : Ui.RailFill);
                g.FillPath(brush, path);
                using var pen = new Pen(hovering && Enabled ? Color.FromArgb(0xA8, 0xB4, 0xC8) : Ui.FieldBorder);
                g.DrawPath(pen, path);
            }
        }

        if (Checked)
        {
            using var pen = new Pen(Color.White, Math.Max(1.6f, Ui.S(2f)))
            {
                StartCap = LineCap.Round,
                EndCap = LineCap.Round,
                LineJoin = LineJoin.Round
            };
            g.DrawLines(pen, new[]
            {
                new PointF(box.X + boxSize * 0.26f, box.Y + boxSize * 0.52f),
                new PointF(box.X + boxSize * 0.44f, box.Y + boxSize * 0.70f),
                new PointF(box.X + boxSize * 0.76f, box.Y + boxSize * 0.32f),
            });
        }

        int textLeft = Ui.S(32);
        int textWidth = Width - textLeft - Ui.S(4);
        if (string.IsNullOrEmpty(Description))
        {
            using var font = Ui.Body(10f);
            Ui.Text(g, Text, font, Enabled ? Ui.Ink : Ui.Faint,
                new Rectangle(textLeft, 0, textWidth, Height), TextFormatFlags.Left | TextFormatFlags.VerticalCenter);
        }
        else
        {
            using var title = Ui.Body(10f);
            using var desc = Ui.Body(9f);
            Ui.Text(g, Text, title, Enabled ? Ui.Ink : Ui.Faint,
                new Rectangle(textLeft, Ui.S(5), textWidth, Ui.S(20)));
            Ui.Text(g, Description, desc, Ui.Faint,
                new Rectangle(textLeft, Ui.S(24), textWidth, Ui.S(18)));
        }
    }
}

/// <summary>A slim determinate progress bar.</summary>
internal sealed class SlimProgress : Control
{
    private double value;

    [System.ComponentModel.Browsable(false)]
    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public double Value
    {
        get => value;
        set
        {
            double clamped = Math.Max(0, Math.Min(100, value));
            if (Math.Abs(clamped - this.value) < 0.01) return;
            this.value = clamped;
            Invalidate();
        }
    }

    public SlimProgress()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                 ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        BackColor = Ui.Surface;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Parent?.BackColor ?? Ui.Surface);

        var track = new RectangleF(0, 0, Width, Height);
        using (var trackPath = Ui.Round(track, Height / 2f))
        using (var brush = new SolidBrush(Ui.Track))
            g.FillPath(brush, trackPath);

        if (value <= 0) return;
        float fillWidth = Math.Max(Height, (float)(Width * value / 100.0));
        var fill = new RectangleF(0, 0, fillWidth, Height);
        using var fillPath = Ui.Round(fill, Height / 2f);
        using var fillBrush = new LinearGradientBrush(
            new RectangleF(0, 0, Math.Max(fillWidth, 1f), Height), Ui.Accent, Ui.AccentDeep, LinearGradientMode.Horizontal);
        g.FillPath(fillBrush, fillPath);
    }
}

/// <summary>A filled circle with a white tick, used on the finish page.</summary>
internal sealed class CheckBadge : Control
{
    public CheckBadge()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                 ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        BackColor = Ui.Surface;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Parent?.BackColor ?? Ui.Surface);

        var circle = new RectangleF(0.5f, 0.5f, Width - 1, Height - 1);
        using (var soft = new SolidBrush(Color.FromArgb(26, Ui.Accent)))
            g.FillEllipse(soft, RectangleF.Inflate(circle, Ui.S(6f), Ui.S(6f)));
        using (var brush = new SolidBrush(Ui.Accent))
            g.FillEllipse(brush, circle);

        float w = Width, h = Height;
        using var pen = new Pen(Color.White, Math.Max(2f, Ui.S(2.6f)))
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round,
            LineJoin = LineJoin.Round
        };
        g.DrawLines(pen, new[]
        {
            new PointF(w * 0.28f, h * 0.52f),
            new PointF(w * 0.44f, h * 0.68f),
            new PointF(w * 0.73f, h * 0.36f),
        });
    }
}

/// <summary>A soft rounded panel with a caption and one wrapping line of body text.</summary>
internal sealed class InfoPlate : Control
{
    private readonly string caption;
    private readonly string body;

    public InfoPlate(string caption, string body)
    {
        this.caption = caption;
        this.body = body;
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                 ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        BackColor = Ui.Surface;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        g.Clear(Parent?.BackColor ?? Ui.Surface);

        var bounds = new RectangleF(0.5f, 0.5f, Width - 1f, Height - 1f);
        using (var path = Ui.Round(bounds, Ui.S(10f)))
        {
            using (var brush = new SolidBrush(Ui.PlateFill))
                g.FillPath(brush, path);
            using var pen = new Pen(Ui.Hairline);
            g.DrawPath(pen, path);
        }

        int padX = Ui.S(16);
        using var captionFont = Ui.Semi(8.5f);
        Ui.Text(g, caption.ToUpperInvariant(), captionFont, Ui.Faint,
            new Rectangle(padX, Ui.S(12), Width - padX * 2, Ui.S(14)));

        using var bodyFont = Ui.Body(9f);
        Ui.Text(g, body, bodyFont, Ui.Muted,
            new Rectangle(padX, Ui.S(30), Width - padX * 2, Height - Ui.S(36)),
            TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.WordBreak | TextFormatFlags.EndEllipsis);
    }
}

internal sealed class InstallerWizard : Form
{
    private const int WelcomeStep = 0;
    private const int DestinationStep = 1;
    private const int OptionsStep = 2;
    private const int ProgressStep = 3;
    private const int FinishStep = 4;

    private const int PadX = 40;
    private const int ContentWidth = 520;

    private readonly bool updateMode;
    private int step = WelcomeStep;
    private bool installing;

    private readonly Panel bodyPanel = new();
    private readonly Panel footer = new();
    private readonly FlatButton btnBack = new();
    private readonly FlatButton btnNext = new();
    private readonly FlatButton btnCancel = new();
    private Sidebar sidebar = null!;

    private Image? appIconImage;
    private Icon? appIcon;
    private readonly string appVersion;

    // State that outlives the controls of any single page.
    private string targetDirectory = string.Empty;
    private bool optDesktop = true;
    private bool optStartMenu = true;
    private bool optPortable;
    private bool optLaunch = true;

    private SlimProgress? progressView;
    private Label? percentView;
    private Label? statusView;

    private string TargetDirectory => string.IsNullOrWhiteSpace(targetDirectory)
        ? DefaultInstallDirectory
        : targetDirectory;

    private static string DefaultInstallDirectory =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Surge");

    public InstallerWizard(string? initialDirectory = null)
    {
        appVersion = "v" + (Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.0.0");

        Ui.ScaleFactor = DeviceDpi / 96f;

        Text = "Surge Setup";
        AutoScaleMode = AutoScaleMode.None;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = true;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Ui.Surface;
        Font = Ui.Body(9.5f);
        DoubleBuffered = true;
        KeyPreview = true;

        updateMode = !string.IsNullOrWhiteSpace(initialDirectory);
        targetDirectory = updateMode ? initialDirectory! : DefaultInstallDirectory;

        LoadEmbeddedAssets();
        if (appIcon is not null) Icon = appIcon;

        BuildLayout();
        ApplyMetrics();
        WireEvents();
        ShowStep(WelcomeStep);
    }

    private void LoadEmbeddedAssets()
    {
        var asm = Assembly.GetExecutingAssembly();
        using (var s = asm.GetManifestResourceStream("icon.png"))
        {
            if (s != null) appIconImage = Image.FromStream(s);
        }
        using (var s = asm.GetManifestResourceStream("icon.ico"))
        {
            if (s != null) appIcon = new Icon(s);
        }
    }

    private void BuildLayout()
    {
        SuspendLayout();

        footer.Dock = DockStyle.Bottom;
        footer.Height = Ui.S(84);
        footer.BackColor = Ui.Surface;
        footer.Paint += (s, e) =>
        {
            using var pen = new Pen(Ui.Hairline);
            e.Graphics.DrawLine(pen, Ui.S(PadX), 0, footer.ClientSize.Width - Ui.S(PadX), 0);
        };
        footer.Resize += (s, e) => LayoutFooter();

        bodyPanel.Dock = DockStyle.Fill;
        bodyPanel.BackColor = Ui.Surface;

        sidebar = new Sidebar(appIconImage, appVersion) { Dock = DockStyle.Left, Width = Ui.S(220) };

        btnNext.Kind = ButtonKind.Primary;
        btnNext.Text = "Next";
        btnNext.TabIndex = 2;

        btnCancel.Kind = ButtonKind.Ghost;
        btnCancel.Text = "Cancel";
        btnCancel.TabIndex = 3;

        btnBack.Kind = ButtonKind.Secondary;
        btnBack.Text = "Back";
        btnBack.TabIndex = 1;

        footer.Controls.AddRange([btnBack, btnNext, btnCancel]);

        Controls.Add(bodyPanel);
        Controls.Add(footer);
        Controls.Add(sidebar);
        ResumeLayout(true);
    }

    /// <summary>
    /// Applies the design metrics for the current DPI. Called once at startup and
    /// again from OnHandleCreated, where DeviceDpi is authoritative — reading it
    /// earlier can report 96 on a scaled display and clip the layout.
    /// </summary>
    private void ApplyMetrics()
    {
        SuspendLayout();

        ClientSize = new Size(Ui.S(820), Ui.S(560));
        footer.Height = Ui.S(84);
        sidebar.Width = Ui.S(220);

        btnNext.Size = new Size(Ui.S(104), Ui.S(38));
        btnCancel.Size = new Size(Ui.S(84), Ui.S(38));
        btnBack.Size = new Size(Ui.S(96), Ui.S(38));

        btnNext.Font = Ui.Semi(9.5f);
        btnCancel.Font = Ui.Body(9.5f);
        btnBack.Font = Ui.Body(9.5f);

        ResumeLayout(true);

        LayoutFooter();
        sidebar.Invalidate();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);

        float actual = DeviceDpi / 96f;
        if (Math.Abs(actual - Ui.ScaleFactor) < 0.01f) return;

        Ui.ScaleFactor = actual;
        ApplyMetrics();
        ShowStep(step);
    }

    private void LayoutFooter()
    {
        int right = footer.ClientSize.Width - Ui.S(PadX);
        int top = (footer.ClientSize.Height - btnNext.Height) / 2;
        btnNext.Location = new Point(right - btnNext.Width, top);
        btnCancel.Location = new Point(btnNext.Left - Ui.S(10) - btnCancel.Width, top);
        btnBack.Location = new Point(btnCancel.Left - Ui.S(10) - btnBack.Width, top);
    }

    private void WireEvents()
    {
        btnNext.Click += async (s, e) => await AdvanceAsync();
        btnBack.Click += (s, e) => ShowStep(step - 1);
        btnCancel.Click += (s, e) => Close();
        FormClosing += (s, e) =>
        {
            if (installing) e.Cancel = true;
        };
        KeyDown += async (s, e) =>
        {
            if (e.KeyCode == Keys.Escape && !installing)
            {
                e.Handled = true;
                Close();
            }
            else if (e.KeyCode == Keys.Enter && btnNext.Enabled && !installing)
            {
                e.Handled = true;
                e.SuppressKeyPress = true;
                await AdvanceAsync();
            }
        };
    }

    private void ShowStep(int index)
    {
        step = Math.Clamp(index, WelcomeStep, FinishStep);
        sidebar.Step = step;

        bodyPanel.SuspendLayout();
        foreach (Control control in bodyPanel.Controls.Cast<Control>().ToArray())
        {
            bodyPanel.Controls.Remove(control);
            control.Dispose();
        }
        progressView = null;
        percentView = null;
        statusView = null;
        bodyPanel.ResumeLayout(false);

        btnBack.Visible = step is DestinationStep or OptionsStep;
        btnCancel.Visible = step != FinishStep;
        btnNext.Enabled = !installing;
        btnCancel.Enabled = !installing;
        btnBack.Enabled = !installing;

        switch (step)
        {
            case WelcomeStep:
                btnNext.Text = "Next";
                RenderWelcome();
                break;
            case DestinationStep:
                btnNext.Text = "Next";
                RenderDestination();
                break;
            case OptionsStep:
                btnNext.Text = updateMode ? "Update" : "Install";
                RenderOptions();
                break;
            case ProgressStep:
                btnNext.Text = updateMode ? "Updating" : "Installing";
                RenderProgress();
                break;
            case FinishStep:
                btnNext.Text = "Finish";
                RenderFinish();
                break;
        }

        sidebar.Invalidate();
        bodyPanel.Invalidate(true);
        LayoutFooter();
    }

    private static Label Title(string text) => new()
    {
        Text = text,
        Font = Ui.Display(17f),
        ForeColor = Ui.Ink,
        AutoSize = false,
        BackColor = Ui.Surface,
        UseMnemonic = false
    };

    private static Label Paragraph(string text, float size = 10f, Color? color = null) => new()
    {
        Text = text,
        Font = Ui.Body(size),
        ForeColor = color ?? Ui.Muted,
        AutoSize = false,
        BackColor = Ui.Surface,
        UseMnemonic = false
    };

    private void Add(Control control) => bodyPanel.Controls.Add(control);

    // ------------------------------------------------------------------ pages

    private void RenderWelcome()
    {
        var title = Title("Welcome to Surge Setup");
        title.SetBounds(Ui.S(PadX), Ui.S(38), Ui.S(ContentWidth), Ui.S(34));
        Add(title);

        var lead = Paragraph(updateMode
            ? "This will update Surge Workspace & Browser on your computer. Your data, shortcuts and settings are kept as they are."
            : "This will install Surge Workspace & Browser on your computer. It runs entirely on this PC — no account, no administrator rights, and no telemetry.");
        lead.SetBounds(Ui.S(PadX), Ui.S(80), Ui.S(ContentWidth), Ui.S(48));
        Add(lead);

        (string Title, string Detail)[] features =
        [
            ("Surge Browser", "Tabs, an isolated profile, and all browsing data on this machine"),
            ("Encrypted Vault", "Passwords and private files behind Argon2id and AES-256-GCM"),
            ("Proxy protection", "Your own proxy server, with a kill switch if it drops"),
            ("Workspace tools", "My Files, My Notes and Downloads in one place"),
        ];

        int top = Ui.S(144);
        foreach (var (feature, detail) in features)
        {
            var row = new FeatureRow(feature, detail);
            row.SetBounds(Ui.S(PadX), top, Ui.S(ContentWidth), Ui.S(48));
            Add(row);
            top += Ui.S(52);
        }

        var plate = new InfoPlate(
            "Before you continue",
            updateMode
                ? "Setup closes Surge with the installer's own folder transaction, then replaces the files. Sign in again only if the app asks."
                : "Surge installs for the current user. No administrator rights are required, and you can remove it later from Windows Settings › Apps.");
        plate.SetBounds(Ui.S(PadX), top + Ui.S(14), Ui.S(ContentWidth), Ui.S(74));
        Add(plate);
    }

    private void RenderDestination()
    {
        var title = Title("Choose install location");
        title.SetBounds(Ui.S(PadX), Ui.S(38), Ui.S(ContentWidth), Ui.S(34));
        Add(title);

        var lead = Paragraph(updateMode
            ? "Surge is already installed here. Setup will update the files in place."
            : "Surge will be installed in the folder below. Choose a folder you can write to.");
        lead.SetBounds(Ui.S(PadX), Ui.S(80), Ui.S(ContentWidth), Ui.S(24));
        Add(lead);

        var caption = Paragraph("Install folder", 9f, Ui.Faint);
        caption.SetBounds(Ui.S(PadX), Ui.S(128), Ui.S(ContentWidth), Ui.S(18));
        Add(caption);

        var field = new PathField();
        field.Input.Text = targetDirectory;
        field.SetBounds(Ui.S(PadX), Ui.S(150), Ui.S(ContentWidth - 100), Ui.S(44));
        Add(field);

        var browse = new FlatButton { Kind = ButtonKind.Secondary, Text = "Browse", Font = Ui.Body(9.5f) };
        browse.SetBounds(Ui.S(PadX + ContentWidth - 92), Ui.S(150), Ui.S(92), Ui.S(44));
        browse.Enabled = !updateMode && field.Enabled;
        Add(browse);

        var space = Paragraph(string.Empty, 9f);
        space.SetBounds(Ui.S(PadX), Ui.S(208), Ui.S(ContentWidth), Ui.S(20));
        Add(space);

        var error = Paragraph(string.Empty, 9f, Ui.Danger);
        error.SetBounds(Ui.S(PadX), Ui.S(232), Ui.S(ContentWidth), Ui.S(38));
        Add(error);

        if (updateMode)
        {
            field.Input.ReadOnly = true;
            field.Input.TabStop = false;
            field.Input.ForeColor = Ui.Muted;
            browse.Enabled = false;
        }

        void RefreshSpace()
        {
            string root;
            try { root = Path.GetPathRoot(field.Input.Text) ?? "C:\\"; }
            catch { root = "C:\\"; }

            try
            {
                var drive = new DriveInfo(root);
                long free = drive.AvailableFreeSpace;
                bool tight = free < 520L * 1024 * 1024;
                space.ForeColor = tight ? Ui.Danger : Ui.Muted;
                space.Text = tight
                    ? $"Not enough space on {drive.Name.TrimEnd('\\')} — Surge needs about 500 MB and {free / (1024 * 1024):N0} MB is free."
                    : $"About 500 MB required  ·  {free / (1024 * 1024):N0} MB available on {drive.Name.TrimEnd('\\')}";
            }
            catch
            {
                space.ForeColor = Ui.Faint;
                space.Text = "About 500 MB required";
            }
        }

        field.Input.TextChanged += (s, e) =>
        {
            targetDirectory = field.Input.Text;
            error.Text = string.Empty;
            RefreshSpace();
        };

        browse.Click += (s, e) =>
        {
            using var dialog = new FolderBrowserDialog
            {
                Description = "Select the Surge installation folder",
                UseDescriptionForTitle = true,
                SelectedPath = field.Input.Text
            };
            if (dialog.ShowDialog(this) != DialogResult.OK) return;
            field.Input.Text = dialog.SelectedPath;
            targetDirectory = dialog.SelectedPath;
            error.Text = string.Empty;
            RefreshSpace();
        };

        RefreshSpace();

        var hint = new InfoPlate(
            "Where this goes",
            "Keep the default folder unless you have a reason to change it. Surge keeps its files and your data together in this folder.");
        hint.SetBounds(Ui.S(PadX), Ui.S(292), Ui.S(ContentWidth), Ui.S(74));
        Add(hint);
    }

    private void RenderOptions()
    {
        var title = Title(updateMode ? "Review update options" : "Additional tasks");
        title.SetBounds(Ui.S(PadX), Ui.S(38), Ui.S(ContentWidth), Ui.S(34));
        Add(title);

        var lead = Paragraph(updateMode
            ? "Setup will update Surge in place. Shortcuts already on this PC are kept."
            : "Choose the shortcuts you want. You can change them later by running Setup again.");
        lead.SetBounds(Ui.S(PadX), Ui.S(80), Ui.S(ContentWidth), Ui.S(24));
        Add(lead);

        var desktop = new TaskCheck
        {
            Text = "Create a desktop shortcut",
            Description = "Puts Surge on your desktop for quick access",
            Checked = optDesktop,
            Font = Ui.Body(10f),
        };
        desktop.SetBounds(Ui.S(PadX), Ui.S(132), Ui.S(ContentWidth), Ui.S(46));
        desktop.CheckedChanged += (s, e) => optDesktop = desktop.Checked;
        Add(desktop);

        var startMenu = new TaskCheck
        {
            Text = "Create a Start menu shortcut",
            Description = "Adds Surge to your Start menu and search results",
            Checked = optStartMenu,
            Font = Ui.Body(10f),
        };
        startMenu.SetBounds(Ui.S(PadX), Ui.S(186), Ui.S(ContentWidth), Ui.S(46));
        startMenu.CheckedChanged += (s, e) => optStartMenu = startMenu.Checked;
        Add(startMenu);

        if (!updateMode)
        {
            var portable = new TaskCheck
            {
                Text = "Install in portable mode",
                Description = "Keeps all data beside the app and skips the Windows uninstall entry",
                Checked = optPortable,
                Font = Ui.Body(10f),
            };
            portable.SetBounds(Ui.S(PadX), Ui.S(240), Ui.S(ContentWidth), Ui.S(46));
            portable.CheckedChanged += (s, e) => optPortable = portable.Checked;
            Add(portable);
        }
        else
        {
            var note = Paragraph("Portable mode cannot be changed by an update.", 9f, Ui.Faint);
            note.SetBounds(Ui.S(PadX), Ui.S(240), Ui.S(ContentWidth), Ui.S(20));
            Add(note);
        }
    }

    private void RenderProgress()
    {
        var title = Title(updateMode ? "Updating Surge" : "Installing Surge");
        title.SetBounds(Ui.S(PadX), Ui.S(38), Ui.S(ContentWidth), Ui.S(34));
        Add(title);

        var lead = Paragraph("This usually takes less than a minute. Keep Setup open until it finishes.");
        lead.SetBounds(Ui.S(PadX), Ui.S(80), Ui.S(ContentWidth), Ui.S(24));
        Add(lead);

        var progress = new SlimProgress();
        progress.SetBounds(Ui.S(PadX), Ui.S(170), Ui.S(ContentWidth), Ui.S(10));
        Add(progress);
        progressView = progress;

        var status = Paragraph("Preparing…", 9f);
        status.SetBounds(Ui.S(PadX), Ui.S(194), Ui.S(ContentWidth - 90), Ui.S(40));
        Add(status);
        statusView = status;

        var percent = Paragraph("0%", 10f, Ui.Accent);
        percent.Font = Ui.Semi(10f);
        percent.TextAlign = ContentAlignment.TopRight;
        percent.SetBounds(Ui.S(PadX + ContentWidth - 80), Ui.S(192), Ui.S(80), Ui.S(20));
        Add(percent);
        percentView = percent;
    }

    private void RenderFinish()
    {
        var badge = new CheckBadge();
        badge.SetBounds(Ui.S(PadX), Ui.S(38), Ui.S(44), Ui.S(44));
        Add(badge);

        var title = Title(updateMode ? "Surge updated" : "Installation complete");
        title.SetBounds(Ui.S(PadX + 62), Ui.S(44), Ui.S(ContentWidth - 62), Ui.S(34));
        Add(title);

        var detail = Paragraph(updateMode
            ? "Surge was updated in place. Your data, shortcuts and settings are unchanged."
            : "Surge was installed successfully. Everything you create stays on this computer.");
        detail.SetBounds(Ui.S(PadX), Ui.S(106), Ui.S(ContentWidth), Ui.S(28));
        Add(detail);

        var location = new InfoPlate("Installed to", TargetDirectory);
        location.SetBounds(Ui.S(PadX), Ui.S(150), Ui.S(ContentWidth), Ui.S(68));
        Add(location);

        var launch = new TaskCheck
        {
            Text = "Launch Surge now",
            Checked = optLaunch,
            Font = Ui.Body(10f),
        };
        launch.SetBounds(Ui.S(PadX), Ui.S(246), Ui.S(ContentWidth), Ui.S(28));
        launch.CheckedChanged += (s, e) => optLaunch = launch.Checked;
        Add(launch);

        var note = Paragraph("Click Finish to close Setup.", 9f, Ui.Faint);
        note.SetBounds(Ui.S(PadX), Ui.S(288), Ui.S(ContentWidth), Ui.S(20));
        Add(note);
    }

    // ------------------------------------------------------------------- flow

    private async Task AdvanceAsync()
    {
        if (installing) return;

        switch (step)
        {
            case WelcomeStep:
                ShowStep(DestinationStep);
                return;

            case DestinationStep:
                if (!ValidateDestination(out string error))
                {
                    ShowDestinationError(error);
                    return;
                }
                ShowStep(OptionsStep);
                return;

            case OptionsStep:
                installing = true;
                ShowStep(ProgressStep);
                try
                {
                    await PerformInstallationAsync();
                    installing = false;
                    ShowStep(FinishStep);
                }
                catch (Exception ex)
                {
                    installing = false;
                    MessageBox.Show(this, "Surge could not be installed:\n\n" + ex.Message,
                        "Surge Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    ShowStep(OptionsStep);
                }
                return;

            case FinishStep:
                if (optLaunch) LaunchSurge();
                Close();
                return;
        }
    }

    private void ShowDestinationError(string message)
    {
        // The error label belongs to the destination page, so return there first.
        if (step != DestinationStep) ShowStep(DestinationStep);
        if (bodyPanel.Controls.OfType<Label>().FirstOrDefault(l => l.ForeColor == Ui.Danger) is { } error)
            error.Text = message;
    }

    private void LaunchSurge()
    {
        string exe = Path.Combine(TargetDirectory, "Surge.exe");
        if (!File.Exists(exe)) return;
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = exe,
                WorkingDirectory = TargetDirectory,
                UseShellExecute = true
            });
        }
        catch { }
    }

    private bool ValidateDestination(out string error)
    {
        error = string.Empty;
        string target = targetDirectory.Trim();

        if (string.IsNullOrWhiteSpace(target))
        {
            error = "Choose a folder to install Surge into.";
            return false;
        }

        try
        {
            target = Path.GetFullPath(target);
        }
        catch
        {
            error = "That folder path is not valid. Choose another folder.";
            return false;
        }

        string trimmedTarget = target.TrimEnd('\\');
        string? root = Path.GetPathRoot(target)?.TrimEnd('\\');
        if (!string.IsNullOrEmpty(root) && string.Equals(root, trimmedTarget, StringComparison.OrdinalIgnoreCase))
        {
            error = "Choose a folder inside a drive, not the drive itself.";
            return false;
        }

        if (updateMode) return true;

        if (Directory.Exists(trimmedTarget) &&
            Directory.EnumerateFileSystemEntries(trimmedTarget).Any() &&
            !File.Exists(Path.Combine(trimmedTarget, "Surge.exe")))
        {
            error = "That folder already contains other files. Choose an empty folder or a new one.";
            return false;
        }

        try
        {
            string probeRoot = Directory.Exists(trimmedTarget) ? trimmedTarget : (Path.GetDirectoryName(trimmedTarget) ?? trimmedTarget);
            Directory.CreateDirectory(probeRoot);
            string probe = Path.Combine(probeRoot, ".surge-write-test");
            File.WriteAllText(probe, "1");
            File.Delete(probe);
        }
        catch (Exception)
        {
            error = "Surge cannot write to that folder. Choose another folder you own.";
            return false;
        }

        return true;
    }

    private async Task PerformInstallationAsync()
    {
        string target = Path.GetFullPath(TargetDirectory);
        Directory.CreateDirectory(target);

        bool portable = optPortable && !updateMode;
        bool desktopShortcut = optDesktop;
        bool startMenuShortcut = optStartMenu;

        await Task.Run(() =>
        {
            var asm = Assembly.GetExecutingAssembly();
            using var stream = asm.GetManifestResourceStream("app.zip")
                ?? throw new InvalidOperationException("The installation package is missing and Setup cannot continue.");

            using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
            int total = Math.Max(1, archive.Entries.Count);
            int count = 0;
            string targetRoot = target.TrimEnd('\\') + "\\";

            foreach (var entry in archive.Entries)
            {
                string destPath = Path.GetFullPath(Path.Combine(target, entry.FullName));
                if (!destPath.StartsWith(targetRoot, StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(destPath.TrimEnd('\\'), target.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
                    continue;

                if (string.IsNullOrEmpty(entry.Name))
                {
                    Directory.CreateDirectory(destPath);
                    continue;
                }

                Directory.CreateDirectory(Path.GetDirectoryName(destPath)!);
                entry.ExtractToFile(destPath, overwrite: true);

                count++;
                double pct = count * 100.0 / total;
                ReportProgress(pct, $"Extracting {entry.Name}");
            }

            string currentExe = Environment.ProcessPath ?? string.Empty;
            if (File.Exists(currentExe))
                File.Copy(currentExe, Path.Combine(target, "Uninstall.exe"), overwrite: true);

            if (portable)
            {
                File.WriteAllText(Path.Combine(target, "portable.flag"), "1");
            }
            else
            {
                File.WriteAllText(Path.Combine(target, "installed.flag"), "1");
                RegisterUninstaller(target);
            }

            string exePath = Path.Combine(target, "Surge.exe");
            ReportProgress(99, "Creating shortcuts");

            if (desktopShortcut)
            {
                string desktopPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Surge.lnk");
                CreateShortcut(desktopPath, exePath, target, "Surge Workspace & Browser");
            }

            if (startMenuShortcut)
            {
                string startDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");
                Directory.CreateDirectory(startDir);
                string startPath = Path.Combine(startDir, "Surge.lnk");
                CreateShortcut(startPath, exePath, target, "Surge Workspace & Browser");
            }

            ReportProgress(100, "Finished.");
        });
    }

    private void ReportProgress(double percent, string status)
    {
        if (IsDisposed) return;
        try
        {
            Invoke(() =>
            {
                if (progressView is { IsDisposed: false }) progressView.Value = percent;
                if (percentView is { IsDisposed: false }) percentView.Text = $"{(int)percent}%";
                if (statusView is { IsDisposed: false }) statusView.Text = status;
            });
        }
        catch (ObjectDisposedException) { }
        catch (InvalidOperationException) { }
    }

    private static void CreateShortcut(string shortcutPath, string targetPath, string workingDir, string description)
    {
        try
        {
            Type? shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType is null) return;
            dynamic shell = Activator.CreateInstance(shellType)!;
            dynamic shortcut = shell.CreateShortcut(shortcutPath);
            shortcut.TargetPath = targetPath;
            shortcut.WorkingDirectory = workingDir;
            shortcut.Description = description;
            string iconFile = Path.Combine(workingDir, "assets", "icon.ico");
            shortcut.IconLocation = File.Exists(iconFile) ? iconFile + ",0" : targetPath + ",0";
            shortcut.Save();
        }
        catch { }
    }

    private static void RegisterUninstaller(string installDir)
    {
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\Surge");
            key.SetValue("DisplayName", "Surge Workspace & Browser");
            key.SetValue("DisplayVersion", Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.0.0");
            key.SetValue("Publisher", "Surge");
            string iconFile = Path.Combine(installDir, "assets", "icon.ico");
            key.SetValue("DisplayIcon", File.Exists(iconFile) ? iconFile : (Path.Combine(installDir, "Surge.exe") + ",0"));
            key.SetValue("InstallLocation", installDir);
            key.SetValue("UninstallString", $"\"{Path.Combine(installDir, "Uninstall.exe")}\" --uninstall");
            key.SetValue("QuietUninstallString", $"\"{Path.Combine(installDir, "Uninstall.exe")}\" --uninstall");
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            key.SetValue("EstimatedSize", 480000, RegistryValueKind.DWord);
        }
        catch { }
    }

#if SCREENSHOT
    // Preview-only hooks used by the design harness; never compiled into Setup.
    internal void PreviewStep(int index) => ShowStep(index);

    internal void PreviewProgress(double percent, string status)
    {
        if (progressView is not null) progressView.Value = percent;
        if (percentView is not null) percentView.Text = $"{(int)percent}%";
        if (statusView is not null) statusView.Text = status;
    }
#endif
}

/// <summary>One line of the welcome page's feature list: accent dot, title, detail.</summary>
internal sealed class FeatureRow : Control
{
    private readonly string title;
    private readonly string detail;

    public FeatureRow(string title, string detail)
    {
        this.title = title;
        this.detail = detail;
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                 ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        BackColor = Ui.Surface;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        g.Clear(Ui.Surface);

        var dot = new RectangleF(Ui.S(2), Ui.S(8), Ui.S(7), Ui.S(7));
        using (var brush = new SolidBrush(Ui.Accent))
            g.FillEllipse(brush, dot);

        using var titleFont = Ui.Semi(10f);
        using var detailFont = Ui.Body(9f);
        Ui.Text(g, title, titleFont, Ui.Ink, new Rectangle(Ui.S(20), 0, Width - Ui.S(20), Ui.S(20)));
        Ui.Text(g, detail, detailFont, Ui.Muted, new Rectangle(Ui.S(20), Ui.S(19), Width - Ui.S(20), Ui.S(20)));
    }
}
