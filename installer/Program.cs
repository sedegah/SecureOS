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

        if (args.Contains("--uninstall"))
        {
            RunUninstall();
            return;
        }

        Application.Run(new InstallerWizard());
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

internal sealed class InstallerWizard : Form
{
    private int step = 0;
    private readonly Panel headerPanel = new();
    private readonly Panel contentPanel = new();
    private readonly Panel footerPanel = new();
    private readonly Button btnBack = new();
    private readonly Button btnNext = new();
    private readonly Button btnCancel = new();

    private Image? bannerImage;
    private Icon? appIcon;

    private readonly TextBox txtPath = new();
    private readonly Button btnBrowse = new();
    private readonly Label lblSpace = new();

    private readonly CheckBox chkDesktop = new();
    private readonly CheckBox chkStartMenu = new();
    private readonly CheckBox chkPortable = new();

    private readonly ProgressBar progressBar = new();
    private readonly Label lblStatus = new();

    private readonly CheckBox chkLaunch = new();

    private string TargetDirectory => txtPath.Text.Trim();

    public InstallerWizard()
    {
        Text = "Surge Setup";
        Size = new Size(660, 560);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = true;
        Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
        BackColor = Color.FromArgb(245, 247, 250);

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
        using (var s = asm.GetManifestResourceStream("icon.ico"))
        {
            if (s != null) appIcon = new Icon(s);
        }
    }

    private void BuildLayout()
    {

        headerPanel.Dock = DockStyle.Top;
        headerPanel.Height = 140;
        headerPanel.BackColor = Color.FromArgb(8, 13, 26);
        headerPanel.Paint += (s, e) =>
        {
            if (bannerImage != null)
            {
                e.Graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;

                float ratio = Math.Max((float)headerPanel.Width / bannerImage.Width, (float)headerPanel.Height / bannerImage.Height);
                int w = (int)(bannerImage.Width * ratio);
                int h = (int)(bannerImage.Height * ratio);
                int x = (headerPanel.Width - w) / 2;
                int y = (headerPanel.Height - h) / 2;
                e.Graphics.DrawImage(bannerImage, x, y, w, h);
            }
        };

        footerPanel.Dock = DockStyle.Bottom;
        footerPanel.Height = 60;
        footerPanel.BackColor = Color.FromArgb(238, 240, 244);
        footerPanel.Paint += (s, e) =>
        {
            e.Graphics.DrawLine(new Pen(Color.FromArgb(220, 224, 230)), 0, 0, footerPanel.Width, 0);
        };

        btnCancel.Text = "Cancel";
        btnCancel.Size = new Size(95, 32);
        btnCancel.Location = new Point(530, 14);
        btnCancel.Click += (s, e) => Close();

        btnNext.Text = "Next >";
        btnNext.Size = new Size(100, 32);
        btnNext.Location = new Point(420, 14);
        btnNext.BackColor = Color.FromArgb(37, 99, 235);
        btnNext.ForeColor = Color.White;
        btnNext.FlatStyle = FlatStyle.Flat;
        btnNext.FlatAppearance.BorderSize = 0;
        btnNext.Click += async (s, e) => await OnNextClicked();

        btnBack.Text = "< Back";
        btnBack.Size = new Size(95, 32);
        btnBack.Location = new Point(315, 14);
        btnBack.Click += (s, e) => ShowStep(step - 1);

        footerPanel.Controls.AddRange([btnBack, btnNext, btnCancel]);

        contentPanel.Dock = DockStyle.Fill;
        contentPanel.Padding = new Padding(30, 20, 30, 20);

        SuspendLayout();
        Controls.Add(contentPanel);
        Controls.Add(headerPanel);
        Controls.Add(footerPanel);
        ResumeLayout(true);
    }

    private void ShowStep(int index)
    {
        step = index;
        contentPanel.Controls.Clear();
        btnCancel.Visible = true;
        btnBack.Visible = true;
        btnBack.Enabled = step > 0 && step < 3;
        btnNext.Enabled = true;
        btnNext.Location = new Point(420, 14);

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
            Font = new Font("Segoe UI", 14f, FontStyle.Bold),
            ForeColor = Color.FromArgb(17, 24, 39),
            AutoSize = true,
            Location = new Point(30, 15)
        };

        var lblDesc = new Label
        {
            Text = "This will install Surge Workspace & Browser on your computer.\n\n" +
                   "• Portable and isolated browser with multi-tab management\n" +
                   "• Encrypted password and secret file vault (Argon2id + AES-256-GCM)\n" +
                   "• Optional biometric fingerprint sensor authentication\n" +
                   "• Built-in proxy protection with automatic kill switch\n" +
                   "• Native notes, bookmarks and USB document organizer\n\n" +
                   "Click Next to continue with the installation.",
            Font = new Font("Segoe UI", 10f),
            ForeColor = Color.FromArgb(55, 65, 81),
            AutoSize = true,
            MaximumSize = new Size(580, 0),
            Location = new Point(30, 52)
        };

        contentPanel.Controls.AddRange([lblTitle, lblDesc]);
    }

    private void RenderDestinationStep()
    {
        btnNext.Text = "Next >";

        var lblTitle = new Label
        {
            Text = "Select Destination Location",
            Font = new Font("Segoe UI", 12f, FontStyle.Bold),
            ForeColor = Color.FromArgb(17, 24, 39),
            AutoSize = true,
            Location = new Point(30, 15)
        };

        var lblDesc = new Label
        {
            Text = "Where should Surge be installed on your computer?",
            Font = new Font("Segoe UI", 9.5f),
            ForeColor = Color.FromArgb(75, 85, 99),
            AutoSize = true,
            Location = new Point(30, 48)
        };

        if (string.IsNullOrEmpty(txtPath.Text))
        {
            string defaultDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Surge");
            txtPath.Text = defaultDir;
        }

        txtPath.Location = new Point(30, 85);
        txtPath.Size = new Size(470, 28);
        txtPath.Font = new Font("Segoe UI", 10f);

        btnBrowse.Text = "Browse...";
        btnBrowse.Size = new Size(100, 30);
        btnBrowse.Location = new Point(510, 84);
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

        lblSpace.Location = new Point(30, 130);
        lblSpace.AutoSize = true;
        lblSpace.MaximumSize = new Size(580, 0);
        lblSpace.Font = new Font("Segoe UI", 9.5f);
        lblSpace.ForeColor = Color.FromArgb(107, 114, 128);
        UpdateSpaceInfo();

        contentPanel.Controls.AddRange([lblTitle, lblDesc, txtPath, btnBrowse, lblSpace]);
    }

    private void UpdateSpaceInfo()
    {
        try
        {
            string root = Path.GetPathRoot(txtPath.Text) ?? "C:\\";
            var drive = new DriveInfo(root);
            long freeMb = drive.AvailableFreeSpace / (1024 * 1024);
            lblSpace.Text = $"Space required: ~460 MB\nSpace available: {freeMb:N0} MB on {drive.Name}";
        }
        catch
        {
            lblSpace.Text = "Space required: ~460 MB";
        }
    }

    private void RenderOptionsStep()
    {
        btnNext.Text = "Install";

        var lblTitle = new Label
        {
            Text = "Select Additional Tasks",
            Font = new Font("Segoe UI", 12f, FontStyle.Bold),
            ForeColor = Color.FromArgb(17, 24, 39),
            AutoSize = true,
            Location = new Point(30, 15)
        };

        var lblDesc = new Label
        {
            Text = "Which shortcuts and options would you like setup to create?",
            Font = new Font("Segoe UI", 9.5f),
            ForeColor = Color.FromArgb(75, 85, 99),
            AutoSize = true,
            Location = new Point(30, 48)
        };

        chkDesktop.Text = "Create a Desktop shortcut";
        chkDesktop.Checked = true;
        chkDesktop.Location = new Point(30, 85);
        chkDesktop.AutoSize = true;

        chkStartMenu.Text = "Create a Start Menu shortcut";
        chkStartMenu.Checked = true;
        chkStartMenu.Location = new Point(30, 120);
        chkStartMenu.AutoSize = true;

        chkPortable.Text = "Install as portable mode (self-contained data folder)";
        chkPortable.Checked = false;
        chkPortable.Location = new Point(30, 155);
        chkPortable.AutoSize = true;

        contentPanel.Controls.AddRange([lblTitle, lblDesc, chkDesktop, chkStartMenu, chkPortable]);
    }

    private void RenderProgressStep()
    {
        btnBack.Enabled = false;
        btnNext.Enabled = false;
        btnCancel.Enabled = false;

        var lblTitle = new Label
        {
            Text = "Installing Surge...",
            Font = new Font("Segoe UI", 12f, FontStyle.Bold),
            ForeColor = Color.FromArgb(17, 24, 39),
            AutoSize = true,
            Location = new Point(30, 15)
        };

        progressBar.Location = new Point(30, 70);
        progressBar.Size = new Size(580, 26);
        progressBar.Style = ProgressBarStyle.Continuous;
        progressBar.Value = 0;

        lblStatus.Location = new Point(30, 110);
        lblStatus.Size = new Size(580, 45);
        lblStatus.Font = new Font("Segoe UI", 9.5f);
        lblStatus.ForeColor = Color.FromArgb(75, 85, 99);
        lblStatus.Text = "Preparing installation...";

        contentPanel.Controls.AddRange([lblTitle, progressBar, lblStatus]);
    }

    private void RenderFinishStep()
    {
        btnBack.Visible = false;
        btnCancel.Visible = false;
        btnNext.Text = "Finish";
        btnNext.Location = new Point(530, 14);

        var lblTitle = new Label
        {
            Text = "Surge Installation Completed",
            Font = new Font("Segoe UI", 14f, FontStyle.Bold),
            ForeColor = Color.FromArgb(17, 24, 39),
            AutoSize = true,
            Location = new Point(30, 15)
        };

        var lblDesc = new Label
        {
            Text = $"Surge has been successfully installed to:\n{TargetDirectory}",
            Font = new Font("Segoe UI", 10f),
            ForeColor = Color.FromArgb(55, 65, 81),
            AutoSize = true,
            MaximumSize = new Size(580, 0),
            Location = new Point(30, 52)
        };

        var lblExit = new Label
        {
            Text = "Click Finish to exit Setup.",
            Font = new Font("Segoe UI", 10f),
            ForeColor = Color.FromArgb(55, 65, 81),
            AutoSize = true,
            Location = new Point(30, Math.Max(120, lblDesc.Bottom + 16))
        };

        chkLaunch.Text = "Launch Surge now";
        chkLaunch.Checked = true;
        chkLaunch.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
        chkLaunch.Location = new Point(30, lblExit.Bottom + 18);
        chkLaunch.AutoSize = true;

        contentPanel.Controls.AddRange([lblTitle, lblDesc, lblExit, chkLaunch]);
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
                });
            }

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
            string iconFile = Path.Combine(workingDir, "assets", "icon.ico");
            if (File.Exists(iconFile))
                shortcut.IconLocation = iconFile + ",0";
            else
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
}

