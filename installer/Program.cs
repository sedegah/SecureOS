using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
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
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.SetDefaultFont(new Font("Segoe UI", 9.5f, FontStyle.Regular));

        if (args.Contains("--uninstall"))
        {
            RunUninstall();
            return;
        }

        Application.Run(new ModernInstallerWizard());
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
            // Remove shortcuts
            string desktopShortcut = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Surge.lnk");
            if (File.Exists(desktopShortcut)) File.Delete(desktopShortcut);

            string startMenuDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");
            string startShortcut = Path.Combine(startMenuDir, "Surge.lnk");
            if (File.Exists(startShortcut)) File.Delete(startShortcut);

            // Remove registry
            using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall", writable: true))
            {
                key?.DeleteSubKeyTree("Surge", throwOnMissingSubKey: false);
            }

            // Self-delete batch
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

internal sealed class ModernInstallerWizard : Form
{
    private int step = 0;
    private const int TotalSteps = 5;

    // Layout Panels
    private readonly Panel headerPanel = new();
    private readonly Panel stepperPanel = new();
    private readonly Panel contentPanel = new();
    private readonly Panel footerPanel = new();

    // Buttons
    private readonly Button btnBack = new();
    private readonly Button btnNext = new();
    private readonly Button btnCancel = new();

    // Assets
    private Image? bannerImage;
    private Image? logoImage;
    private Icon? appIcon;

    // Step 1: Destination Controls
    private readonly TextBox txtPath = new();
    private readonly Button btnBrowse = new();
    private readonly Label lblSpaceRequired = new();
    private readonly Label lblSpaceAvailable = new();
    private readonly ProgressBar diskProgressBar = new();

    // Step 2: Options Controls
    private readonly CheckBox chkDesktop = new();
    private readonly CheckBox chkStartMenu = new();
    private readonly CheckBox chkPortable = new();

    // Step 3: Progress Controls
    private readonly ProgressBar progressBar = new();
    private readonly Label lblStatus = new();
    private readonly Label lblProgressPct = new();

    // Step 4: Finish Controls
    private readonly CheckBox chkLaunch = new();

    private string TargetDirectory => txtPath.Text.Trim();

    private static readonly string[] StepTitles = [
        "Welcome",
        "Destination",
        "Options",
        "Installing",
        "Finished"
    ];

    private static readonly string[] StepDescriptions = [
        "Setup and Deployment Wizard",
        "Select Installation Location",
        "Configure Shortcuts and Integration",
        "Extracting Application Packages",
        "Deployment Complete"
    ];

    public ModernInstallerWizard()
    {
        Text = "Surge Setup";
        Size = new Size(720, 570);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = true;
        Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
        BackColor = Color.FromArgb(248, 250, 252);

        LoadEmbeddedAssets();
        if (appIcon is not null) Icon = appIcon;

        BuildLayout();
        ShowStep(0);
    }

    private void LoadEmbeddedAssets()
    {
        var asm = Assembly.GetExecutingAssembly();
        using (var s = asm.GetManifestResourceStream("splash.jpg"))
        {
            if (s != null) bannerImage = Image.FromStream(s);
        }
        using (var s = asm.GetManifestResourceStream("logo.jpg") ?? asm.GetManifestResourceStream("icon.png"))
        {
            if (s != null) logoImage = Image.FromStream(s);
        }
        using (var s = asm.GetManifestResourceStream("icon.ico"))
        {
            if (s != null) appIcon = new Icon(s);
        }
    }

    private void BuildLayout()
    {
        // 1. Header Banner Panel (Height: 110px)
        headerPanel.Dock = DockStyle.Top;
        headerPanel.Height = 110;
        headerPanel.BackColor = Color.FromArgb(10, 16, 32);
        headerPanel.Paint += (s, e) =>
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.HighQuality;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;

            // Draw banner image right-aligned with subtle gradient fade
            if (bannerImage != null)
            {
                float ratio = (float)headerPanel.Height / bannerImage.Height;
                int imgW = (int)(bannerImage.Width * ratio);
                int imgH = headerPanel.Height;
                int imgX = headerPanel.Width - imgW;
                g.DrawImage(bannerImage, imgX, 0, imgW, imgH);

                // Gradient fade over the banner image
                using var fadeBrush = new LinearGradientBrush(
                    new Point(headerPanel.Width - imgW - 10, 0),
                    new Point(headerPanel.Width - (imgW / 3), 0),
                    Color.FromArgb(10, 16, 32),
                    Color.FromArgb(0, 10, 16, 32));
                g.FillRectangle(fadeBrush, headerPanel.Width - imgW - 10, 0, imgW, imgH);
            }

            // Draw Logo on left
            if (logoImage != null)
            {
                var logoRect = new Rectangle(24, 25, 60, 60);
                using var path = new GraphicsPath();
                path.AddEllipse(logoRect);
                g.SetClip(path);
                g.DrawImage(logoImage, logoRect);
                g.ResetClip();

                // Subtle border around logo
                using var borderPen = new Pen(Color.FromArgb(59, 130, 246), 2);
                g.DrawEllipse(borderPen, logoRect);
            }

            int textLeft = logoImage != null ? 96 : 28;

            // Title
            using var titleBrush = new SolidBrush(Color.White);
            using var titleFont = new Font("Segoe UI", 15f, FontStyle.Bold);
            g.DrawString("Surge Workspace & Browser", titleFont, titleBrush, textLeft, 28);

            // Subtitle
            using var subBrush = new SolidBrush(Color.FromArgb(148, 163, 184));
            using var subFont = new Font("Segoe UI", 10f, FontStyle.Regular);
            string desc = step < StepDescriptions.Length ? StepDescriptions[step] : "Setup";
            g.DrawString(desc, subFont, subBrush, textLeft, 58);

            // Bottom subtle divider line
            using var dividerPen = new Pen(Color.FromArgb(30, 41, 59));
            g.DrawLine(dividerPen, 0, headerPanel.Height - 1, headerPanel.Width, headerPanel.Height - 1);
        };

        // 2. Stepper Progress Navigation Bar (Height: 38px)
        stepperPanel.Dock = DockStyle.Top;
        stepperPanel.Height = 38;
        stepperPanel.BackColor = Color.FromArgb(241, 245, 249);
        stepperPanel.Paint += (s, e) =>
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            int stepCount = StepTitles.Length;
            int stepWidth = stepperPanel.Width / stepCount;

            for (int i = 0; i < stepCount; i++)
            {
                int x = i * stepWidth;
                bool isCurrent = i == step;
                bool isCompleted = i < step;

                // Step number circle
                int circleSize = 20;
                int circleX = x + (stepWidth / 2) - 50;
                int circleY = 9;

                Color circleColor = isCurrent ? Color.FromArgb(37, 99, 235)
                                  : isCompleted ? Color.FromArgb(16, 185, 129)
                                  : Color.FromArgb(203, 213, 225);

                using (var brush = new SolidBrush(circleColor))
                {
                    g.FillEllipse(brush, circleX, circleY, circleSize, circleSize);
                }

                // Checkmark or Number inside circle
                using (var textBrush = new SolidBrush(Color.White))
                using (var numFont = new Font("Segoe UI", 8.5f, FontStyle.Bold))
                {
                    string label = isCompleted ? "✓" : (i + 1).ToString();
                    var size = g.MeasureString(label, numFont);
                    g.DrawString(label, numFont, textBrush, circleX + (circleSize - size.Width) / 2, circleY + (circleSize - size.Height) / 2);
                }

                // Step Title Text
                Color textColor = isCurrent ? Color.FromArgb(15, 23, 42)
                                : isCompleted ? Color.FromArgb(71, 85, 105)
                                : Color.FromArgb(148, 163, 184);

                using var titleBrush = new SolidBrush(textColor);
                using var titleFont = new Font("Segoe UI", 9f, isCurrent ? FontStyle.Bold : FontStyle.Regular);
                g.DrawString(StepTitles[i], titleFont, titleBrush, circleX + circleSize + 8, 10);

                // Connecting line between steps
                if (i < stepCount - 1)
                {
                    int lineStartX = circleX + circleSize + 65;
                    int lineEndX = (i + 1) * stepWidth + (stepWidth / 2) - 60;
                    if (lineEndX > lineStartX)
                    {
                        using var linePen = new Pen(isCompleted ? Color.FromArgb(16, 185, 129) : Color.FromArgb(226, 232, 240), 2);
                        g.DrawLine(linePen, lineStartX, 19, lineEndX, 19);
                    }
                }
            }

            // Bottom border
            using var bottomPen = new Pen(Color.FromArgb(226, 232, 240));
            g.DrawLine(bottomPen, 0, stepperPanel.Height - 1, stepperPanel.Width, stepperPanel.Height - 1);
        };

        // 3. Footer Bar (Height: 65px)
        footerPanel.Dock = DockStyle.Bottom;
        footerPanel.Height = 65;
        footerPanel.BackColor = Color.FromArgb(241, 245, 249);
        footerPanel.Paint += (s, e) =>
        {
            e.Graphics.DrawLine(new Pen(Color.FromArgb(226, 232, 240)), 0, 0, footerPanel.Width, 0);
        };

        btnCancel.Text = "Cancel";
        btnCancel.Size = new Size(100, 36);
        btnCancel.Location = new Point(590, 14);
        btnCancel.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;
        btnCancel.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
        btnCancel.BackColor = Color.White;
        btnCancel.ForeColor = Color.FromArgb(71, 85, 105);
        btnCancel.FlatStyle = FlatStyle.Flat;
        btnCancel.FlatAppearance.BorderColor = Color.FromArgb(203, 213, 225);
        btnCancel.Click += (s, e) => Close();

        btnNext.Text = "Next >";
        btnNext.Size = new Size(110, 36);
        btnNext.Location = new Point(470, 14);
        btnNext.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;
        btnNext.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
        btnNext.BackColor = Color.FromArgb(37, 99, 235);
        btnNext.ForeColor = Color.White;
        btnNext.FlatStyle = FlatStyle.Flat;
        btnNext.FlatAppearance.BorderSize = 0;
        btnNext.Click += async (s, e) => await OnNextClicked();

        btnBack.Text = "< Back";
        btnBack.Size = new Size(100, 36);
        btnBack.Location = new Point(360, 14);
        btnBack.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;
        btnBack.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
        btnBack.BackColor = Color.White;
        btnBack.ForeColor = Color.FromArgb(71, 85, 105);
        btnBack.FlatStyle = FlatStyle.Flat;
        btnBack.FlatAppearance.BorderColor = Color.FromArgb(203, 213, 225);
        btnBack.Click += (s, e) => ShowStep(step - 1);

        footerPanel.Controls.AddRange([btnBack, btnNext, btnCancel]);

        // 4. Content Area
        contentPanel.Dock = DockStyle.Fill;
        contentPanel.Padding = new Padding(32, 20, 32, 20);

        Controls.Add(contentPanel);
        Controls.Add(stepperPanel);
        Controls.Add(headerPanel);
        Controls.Add(footerPanel);
    }

    private void ShowStep(int index)
    {
        step = index;
        contentPanel.Controls.Clear();
        headerPanel.Invalidate();
        stepperPanel.Invalidate();

        btnBack.Visible = step > 0 && step < 4;
        btnBack.Enabled = step > 0 && step < 3;
        btnNext.Enabled = true;

        switch (step)
        {
            case 0:
                RenderWelcomeStep();
                break;
            case 1:
                RenderDestinationStep();
                break;
            case 2:
                RenderOptionsStep();
                break;
            case 3:
                RenderProgressStep();
                break;
            case 4:
                RenderFinishStep();
                break;
        }
    }

    private void RenderWelcomeStep()
    {
        btnNext.Text = "Next >";

        var lblTitle = new Label
        {
            Text = "Welcome to Surge Setup",
            Font = new Font("Segoe UI", 15f, FontStyle.Bold),
            ForeColor = Color.FromArgb(15, 23, 42),
            AutoSize = true,
            Location = new Point(32, 12)
        };

        var lblDesc = new Label
        {
            Text = "Surge is a high-performance, private workspace and isolated browser built for portable and desktop use.",
            Font = new Font("Segoe UI", 10f),
            ForeColor = Color.FromArgb(71, 85, 105),
            AutoSize = true,
            MaximumSize = new Size(640, 0),
            Location = new Point(32, 46)
        };

        // 4 Feature Highlight Cards
        int cardY = 82;
        var card1 = CreateFeatureBadge("🌐", "Surge Browser", "Isolated multi-tab Chromium engine with proxy protection and private profiles.", 32, cardY, 640);
        var card2 = CreateFeatureBadge("🔒", "Encrypted Vault", "Zero-cloud password and private file vault powered by Argon2id & AES-256-GCM.", 32, cardY + 54, 640);
        var card3 = CreateFeatureBadge("🛡️", "Network Proxy", "Built-in SOCKS5/HTTPS routing with fail-closed automatic kill switch.", 32, cardY + 108, 640);
        var card4 = CreateFeatureBadge("⚡", "Native & Offline", "Fully self-contained: works on hard drives or USB pendrives without cloud reliance.", 32, cardY + 162, 640);

        var lblFooter = new Label
        {
            Text = "Click Next to choose your installation settings.",
            Font = new Font("Segoe UI", 9.5f, FontStyle.Italic),
            ForeColor = Color.FromArgb(100, 116, 139),
            AutoSize = true,
            Location = new Point(32, cardY + 228)
        };

        contentPanel.Controls.AddRange([lblTitle, lblDesc, card1, card2, card3, card4, lblFooter]);
    }

    private static Panel CreateFeatureBadge(string emoji, string title, string description, int x, int y, int width)
    {
        var panel = new Panel
        {
            Location = new Point(x, y),
            Size = new Size(width, 48),
            BackColor = Color.White
        };

        panel.Paint += (s, e) =>
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using var pen = new Pen(Color.FromArgb(226, 232, 240));
            e.Graphics.DrawRectangle(pen, 0, 0, panel.Width - 1, panel.Height - 1);
        };

        var lblEmoji = new Label
        {
            Text = emoji,
            Font = new Font("Segoe UI Emoji", 14f),
            Size = new Size(36, 36),
            Location = new Point(8, 6),
            TextAlign = ContentAlignment.MiddleCenter
        };

        var lblTitle = new Label
        {
            Text = title,
            Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
            ForeColor = Color.FromArgb(15, 23, 42),
            AutoSize = true,
            Location = new Point(48, 6)
        };

        var lblDesc = new Label
        {
            Text = description,
            Font = new Font("Segoe UI", 8.5f),
            ForeColor = Color.FromArgb(100, 116, 139),
            AutoSize = true,
            Location = new Point(48, 26)
        };

        panel.Controls.AddRange([lblEmoji, lblTitle, lblDesc]);
        return panel;
    }

    private void RenderDestinationStep()
    {
        btnNext.Text = "Next >";

        var lblTitle = new Label
        {
            Text = "Select Installation Folder",
            Font = new Font("Segoe UI", 14f, FontStyle.Bold),
            ForeColor = Color.FromArgb(15, 23, 42),
            AutoSize = true,
            Location = new Point(32, 12)
        };

        var lblDesc = new Label
        {
            Text = "Setup will install Surge into the directory selected below. To install to a different folder, click Browse.",
            Font = new Font("Segoe UI", 9.5f),
            ForeColor = Color.FromArgb(71, 85, 105),
            AutoSize = true,
            MaximumSize = new Size(640, 0),
            Location = new Point(32, 44)
        };

        if (string.IsNullOrEmpty(txtPath.Text))
        {
            string defaultDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Surge");
            txtPath.Text = defaultDir;
        }

        // Folder selection box
        var folderCard = new Panel
        {
            Location = new Point(32, 85),
            Size = new Size(640, 52),
            BackColor = Color.White
        };
        folderCard.Paint += (s, e) =>
        {
            using var pen = new Pen(Color.FromArgb(203, 213, 225));
            e.Graphics.DrawRectangle(pen, 0, 0, folderCard.Width - 1, folderCard.Height - 1);
        };

        txtPath.Location = new Point(12, 12);
        txtPath.Size = new Size(505, 28);
        txtPath.Font = new Font("Segoe UI", 10f);
        txtPath.BorderStyle = BorderStyle.None;

        btnBrowse.Text = "Browse...";
        btnBrowse.Size = new Size(95, 30);
        btnBrowse.Location = new Point(532, 10);
        btnBrowse.Font = new Font("Segoe UI", 9f, FontStyle.Regular);
        btnBrowse.BackColor = Color.FromArgb(241, 245, 249);
        btnBrowse.FlatStyle = FlatStyle.Flat;
        btnBrowse.FlatAppearance.BorderColor = Color.FromArgb(203, 213, 225);
        btnBrowse.Click += (s, e) =>
        {
            using var dlg = new FolderBrowserDialog();
            dlg.Description = "Select Surge installation folder";
            dlg.SelectedPath = txtPath.Text;
            if (dlg.ShowDialog() == DialogResult.OK)
            {
                txtPath.Text = dlg.SelectedPath;
                UpdateSpaceInfo();
            }
        };

        folderCard.Controls.AddRange([txtPath, btnBrowse]);

        // Disk Space Details Card
        var spaceCard = new Panel
        {
            Location = new Point(32, 155),
            Size = new Size(640, 100),
            BackColor = Color.White
        };
        spaceCard.Paint += (s, e) =>
        {
            using var pen = new Pen(Color.FromArgb(226, 232, 240));
            e.Graphics.DrawRectangle(pen, 0, 0, spaceCard.Width - 1, spaceCard.Height - 1);
        };

        lblSpaceRequired.Location = new Point(16, 14);
        lblSpaceRequired.AutoSize = true;
        lblSpaceRequired.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
        lblSpaceRequired.ForeColor = Color.FromArgb(15, 23, 42);
        lblSpaceRequired.Text = "Space Required: ~460 MB";

        lblSpaceAvailable.Location = new Point(16, 38);
        lblSpaceAvailable.AutoSize = true;
        lblSpaceAvailable.Font = new Font("Segoe UI", 9f);
        lblSpaceAvailable.ForeColor = Color.FromArgb(71, 85, 105);

        diskProgressBar.Location = new Point(16, 66);
        diskProgressBar.Size = new Size(605, 14);
        diskProgressBar.Style = ProgressBarStyle.Continuous;

        spaceCard.Controls.AddRange([lblSpaceRequired, lblSpaceAvailable, diskProgressBar]);
        UpdateSpaceInfo();

        contentPanel.Controls.AddRange([lblTitle, lblDesc, folderCard, spaceCard]);
    }

    private void UpdateSpaceInfo()
    {
        try
        {
            string root = Path.GetPathRoot(txtPath.Text) ?? "C:\\";
            var drive = new DriveInfo(root);
            long freeMb = drive.AvailableFreeSpace / (1024 * 1024);
            long totalMb = drive.TotalSize / (1024 * 1024);
            int usedPct = (int)(((totalMb - freeMb) / (double)totalMb) * 100);

            lblSpaceAvailable.Text = $"Available Free Space: {freeMb:N0} MB on Drive ({drive.Name.TrimEnd('\\')})";
            diskProgressBar.Value = Math.Max(0, Math.Min(100, usedPct));
        }
        catch
        {
            lblSpaceAvailable.Text = "Available Free Space: Sufficient";
            diskProgressBar.Value = 30;
        }
    }

    private void RenderOptionsStep()
    {
        btnNext.Text = "Install";

        var lblTitle = new Label
        {
            Text = "Select Additional Tasks",
            Font = new Font("Segoe UI", 14f, FontStyle.Bold),
            ForeColor = Color.FromArgb(15, 23, 42),
            AutoSize = true,
            Location = new Point(32, 12)
        };

        var lblDesc = new Label
        {
            Text = "Choose how Surge should be integrated with your Windows environment:",
            Font = new Font("Segoe UI", 9.5f),
            ForeColor = Color.FromArgb(71, 85, 105),
            AutoSize = true,
            Location = new Point(32, 44)
        };

        var optionsPanel = new Panel
        {
            Location = new Point(32, 80),
            Size = new Size(640, 160),
            BackColor = Color.White
        };
        optionsPanel.Paint += (s, e) =>
        {
            using var pen = new Pen(Color.FromArgb(226, 232, 240));
            e.Graphics.DrawRectangle(pen, 0, 0, optionsPanel.Width - 1, optionsPanel.Height - 1);
        };

        chkDesktop.Text = "Create a Desktop shortcut";
        chkDesktop.Checked = true;
        chkDesktop.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
        chkDesktop.ForeColor = Color.FromArgb(15, 23, 42);
        chkDesktop.Location = new Point(16, 16);
        chkDesktop.AutoSize = true;

        var lblDesktopSub = new Label
        {
            Text = "Places a quick launch icon on your Windows desktop.",
            Font = new Font("Segoe UI", 8.5f),
            ForeColor = Color.FromArgb(100, 116, 139),
            Location = new Point(36, 40),
            AutoSize = true
        };

        chkStartMenu.Text = "Create a Start Menu shortcut";
        chkStartMenu.Checked = true;
        chkStartMenu.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
        chkStartMenu.ForeColor = Color.FromArgb(15, 23, 42);
        chkStartMenu.Location = new Point(16, 66);
        chkStartMenu.AutoSize = true;

        var lblStartSub = new Label
        {
            Text = "Adds Surge to the Windows Start Menu programs list.",
            Font = new Font("Segoe UI", 8.5f),
            ForeColor = Color.FromArgb(100, 116, 139),
            Location = new Point(36, 90),
            AutoSize = true
        };

        chkPortable.Text = "Install in portable mode (self-contained data directory)";
        chkPortable.Checked = false;
        chkPortable.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
        chkPortable.ForeColor = Color.FromArgb(15, 23, 42);
        chkPortable.Location = new Point(16, 116);
        chkPortable.AutoSize = true;

        optionsPanel.Controls.AddRange([chkDesktop, lblDesktopSub, chkStartMenu, lblStartSub, chkPortable]);

        contentPanel.Controls.AddRange([lblTitle, lblDesc, optionsPanel]);
    }

    private void RenderProgressStep()
    {
        btnBack.Enabled = false;
        btnNext.Enabled = false;
        btnCancel.Enabled = false;

        var lblTitle = new Label
        {
            Text = "Installing Surge...",
            Font = new Font("Segoe UI", 14f, FontStyle.Bold),
            ForeColor = Color.FromArgb(15, 23, 42),
            AutoSize = true,
            Location = new Point(32, 12)
        };

        var lblDesc = new Label
        {
            Text = "Please wait while setup deploys Surge Workspace & Browser to your computer.",
            Font = new Font("Segoe UI", 9.5f),
            ForeColor = Color.FromArgb(71, 85, 105),
            AutoSize = true,
            Location = new Point(32, 44)
        };

        var progressCard = new Panel
        {
            Location = new Point(32, 85),
            Size = new Size(640, 120),
            BackColor = Color.White
        };
        progressCard.Paint += (s, e) =>
        {
            using var pen = new Pen(Color.FromArgb(226, 232, 240));
            e.Graphics.DrawRectangle(pen, 0, 0, progressCard.Width - 1, progressCard.Height - 1);
        };

        progressBar.Location = new Point(16, 24);
        progressBar.Size = new Size(605, 24);
        progressBar.Style = ProgressBarStyle.Continuous;
        progressBar.Value = 0;

        lblStatus.Location = new Point(16, 60);
        lblStatus.Size = new Size(500, 30);
        lblStatus.Font = new Font("Segoe UI", 9f);
        lblStatus.ForeColor = Color.FromArgb(71, 85, 105);
        lblStatus.Text = "Preparing installation package...";

        lblProgressPct.Location = new Point(520, 60);
        lblProgressPct.Size = new Size(100, 30);
        lblProgressPct.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
        lblProgressPct.ForeColor = Color.FromArgb(37, 99, 235);
        lblProgressPct.TextAlign = ContentAlignment.TopRight;
        lblProgressPct.Text = "0%";

        progressCard.Controls.AddRange([progressBar, lblStatus, lblProgressPct]);

        contentPanel.Controls.AddRange([lblTitle, lblDesc, progressCard]);
    }

    private void RenderFinishStep()
    {
        btnBack.Visible = false;
        btnCancel.Visible = false;
        btnNext.Text = "Finish";
        btnNext.Size = new Size(120, 36);
        btnNext.Location = new Point(568, 14);

        // Success Badge Icon
        var badgePanel = new Panel
        {
            Location = new Point(32, 15),
            Size = new Size(56, 56),
            BackColor = Color.Transparent
        };
        badgePanel.Paint += (s, e) =>
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            // Green circle
            using var bgBrush = new SolidBrush(Color.FromArgb(16, 185, 129));
            g.FillEllipse(bgBrush, 2, 2, 52, 52);

            // White Checkmark
            using var checkPen = new Pen(Color.White, 3.5f) { StartCap = LineCap.Round, EndCap = LineCap.Round };
            g.DrawLines(checkPen, [new Point(16, 28), new Point(24, 37), new Point(39, 19)]);
        };

        var lblTitle = new Label
        {
            Text = "Installation Completed Successfully",
            Font = new Font("Segoe UI", 15f, FontStyle.Bold),
            ForeColor = Color.FromArgb(15, 23, 42),
            AutoSize = true,
            Location = new Point(98, 16)
        };

        var lblDesc = new Label
        {
            Text = "Surge Workspace & Browser has been deployed on your computer.",
            Font = new Font("Segoe UI", 10f),
            ForeColor = Color.FromArgb(71, 85, 105),
            AutoSize = true,
            Location = new Point(98, 44)
        };

        // Summary Path Card
        var summaryCard = new Panel
        {
            Location = new Point(32, 90),
            Size = new Size(640, 75),
            BackColor = Color.White
        };
        summaryCard.Paint += (s, e) =>
        {
            using var pen = new Pen(Color.FromArgb(226, 232, 240));
            e.Graphics.DrawRectangle(pen, 0, 0, summaryCard.Width - 1, summaryCard.Height - 1);
        };

        var lblPathLabel = new Label
        {
            Text = "INSTALLATION LOCATION",
            Font = new Font("Segoe UI", 8f, FontStyle.Bold),
            ForeColor = Color.FromArgb(148, 163, 184),
            Location = new Point(14, 12),
            AutoSize = true
        };

        var lblPathValue = new Label
        {
            Text = TargetDirectory,
            Font = new Font("Segoe UI", 9.5f, FontStyle.Regular),
            ForeColor = Color.FromArgb(15, 23, 42),
            Location = new Point(14, 34),
            AutoSize = true,
            MaximumSize = new Size(610, 0)
        };

        summaryCard.Controls.AddRange([lblPathLabel, lblPathValue]);

        // Launch Checkbox
        chkLaunch.Text = "Launch Surge now";
        chkLaunch.Checked = true;
        chkLaunch.Font = new Font("Segoe UI", 11f, FontStyle.Bold);
        chkLaunch.ForeColor = Color.FromArgb(15, 23, 42);
        chkLaunch.Location = new Point(32, 185);
        chkLaunch.AutoSize = true;

        var lblExitHint = new Label
        {
            Text = "Click Finish to exit the setup wizard.",
            Font = new Font("Segoe UI", 9.5f),
            ForeColor = Color.FromArgb(100, 116, 139),
            Location = new Point(32, 225),
            AutoSize = true
        };

        contentPanel.Controls.AddRange([badgePanel, lblTitle, lblDesc, summaryCard, chkLaunch, lblExitHint]);
    }

    private async Task OnNextClicked()
    {
        if (step < 2)
        {
            ShowStep(step + 1);
            return;
        }

        if (step == 2)
        {
            ShowStep(3);
            await PerformInstallationAsync();
            ShowStep(4);
            return;
        }

        if (step == 4)
        {
            if (chkLaunch.Checked)
            {
                string exe = Path.Combine(TargetDirectory, "Surge.exe");
                if (File.Exists(exe))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = exe,
                        WorkingDirectory = TargetDirectory,
                        UseShellExecute = true
                    });
                }
            }
            Close();
        }
    }

    private async Task PerformInstallationAsync()
    {
        string target = TargetDirectory;
        Directory.CreateDirectory(target);

        await Task.Run(() =>
        {
            var asm = Assembly.GetExecutingAssembly();
            using var stream = asm.GetManifestResourceStream("app.zip")
                ?? throw new InvalidOperationException("Installation package is missing.");

            using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
            int total = archive.Entries.Count;
            int count = 0;

            foreach (var entry in archive.Entries)
            {
                string destPath = Path.GetFullPath(Path.Combine(target, entry.FullName));
                if (!destPath.StartsWith(target, StringComparison.OrdinalIgnoreCase))
                    continue;

                if (string.IsNullOrEmpty(entry.Name))
                {
                    Directory.CreateDirectory(destPath);
                    continue;
                }

                Directory.CreateDirectory(Path.GetDirectoryName(destPath)!);
                entry.ExtractToFile(destPath, overwrite: true);

                count++;
                int pct = (int)((count / (float)total) * 100);
                Invoke(() =>
                {
                    progressBar.Value = Math.Min(100, pct);
                    lblStatus.Text = $"Extracting: {entry.Name}";
                    lblProgressPct.Text = $"{pct}%";
                });
            }

            // Copy setup itself as Uninstaller
            string currentExe = Environment.ProcessPath ?? "";
            if (File.Exists(currentExe))
            {
                File.Copy(currentExe, Path.Combine(target, "Uninstall.exe"), overwrite: true);
            }

            if (chkPortable.Checked)
            {
                File.WriteAllText(Path.Combine(target, "portable.flag"), "1");
            }
            else
            {
                File.WriteAllText(Path.Combine(target, "installed.flag"), "1");
                RegisterUninstaller(target);
            }

            string exePath = Path.Combine(target, "Surge.exe");

            // Shortcuts
            if (chkDesktop.Checked)
            {
                string desktopPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Surge.lnk");
                CreateShortcut(desktopPath, exePath, target, "Surge Workspace & Browser");
            }

            if (chkStartMenu.Checked)
            {
                string startDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");
                Directory.CreateDirectory(startDir);
                string startPath = Path.Combine(startDir, "Surge.lnk");
                CreateShortcut(startPath, exePath, target, "Surge Workspace & Browser");
            }
        });
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
            shortcut.IconLocation = targetPath + ",0";
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
            key.SetValue("DisplayVersion", "1.0.0");
            key.SetValue("Publisher", "Surge");
            key.SetValue("DisplayIcon", Path.Combine(installDir, "Surge.exe") + ",0");
            key.SetValue("InstallLocation", installDir);
            key.SetValue("UninstallString", $"\"{Path.Combine(installDir, "Uninstall.exe")}\" --uninstall");
            key.SetValue("QuietUninstallString", $"\"{Path.Combine(installDir, "Uninstall.exe")}\" --uninstall");
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            key.SetValue("EstimatedSize", 480000, RegistryValueKind.DWord);
        }
        catch { }
    }
}
