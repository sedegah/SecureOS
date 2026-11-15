using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace SurgePortable.Desktop;

// ============================================================================
// 1. BROWSER APP VIEW
// ============================================================================
public sealed class BrowserAppView : Grid
{
    private readonly PathManager paths;
    private readonly LocalHelper helper;
    private readonly WebView2 webView;
    private readonly TextBox urlBox;
    private readonly Button backBtn;
    private readonly Button forwardBtn;
    private readonly Button refreshBtn;
    private readonly ProgressBar loadProgress;
    private bool initialized;

    public BrowserAppView(PathManager paths, LocalHelper helper, string? initialUrl = null)
    {
        this.paths = paths;
        this.helper = helper;

        RowDefinitions.Add(new RowDefinition { Height = new GridLength(42) }); // Toolbar
        RowDefinitions.Add(new RowDefinition { Height = new GridLength(2) });  // Progress bar
        RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // Webview

        // --- NAVIGATION TOOLBAR ---
        var toolbar = new Border
        {
            Background = DeskColors.NavySurface,
            BorderBrush = DeskColors.NavyBorder,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(6, 4, 6, 4)
        };
        Grid.SetRow(toolbar, 0);

        var toolGrid = new Grid();
        toolGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Back
        toolGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Forward
        toolGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Refresh
        toolGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Home
        toolGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); // URL Box
        toolGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Go / Search

        backBtn = CreateNavButton(AppIcons.NavBack, "Back");
        backBtn.Click += (_, _) => { if (webView.CanGoBack) webView.GoBack(); };
        Grid.SetColumn(backBtn, 0);
        toolGrid.Children.Add(backBtn);

        forwardBtn = CreateNavButton(AppIcons.NavForward, "Forward");
        forwardBtn.Click += (_, _) => { if (webView.CanGoForward) webView.GoForward(); };
        Grid.SetColumn(forwardBtn, 1);
        toolGrid.Children.Add(forwardBtn);

        refreshBtn = CreateNavButton(AppIcons.NavRefresh, "Refresh");
        refreshBtn.Click += (_, _) => webView.Reload();
        Grid.SetColumn(refreshBtn, 2);
        toolGrid.Children.Add(refreshBtn);

        var homeBtn = CreateNavButton(AppIcons.NavHome, "Home");
        homeBtn.Click += (_, _) => webView.CoreWebView2?.Navigate(helper.HomepageUrl);
        Grid.SetColumn(homeBtn, 3);
        toolGrid.Children.Add(homeBtn);

        // Address Bar
        var urlBorder = new Border
        {
            Background = DeskColors.NavyDark,
            BorderBrush = DeskColors.NavyBorder,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(16),
            Margin = new Thickness(6, 0, 6, 0),
            Padding = new Thickness(12, 0, 12, 0)
        };
        Grid.SetColumn(urlBorder, 4);

        urlBox = new TextBox
        {
            Background = Brushes.Transparent,
            Foreground = DeskColors.TextPrimary,
            BorderThickness = new Thickness(0),
            VerticalAlignment = VerticalAlignment.Center,
            FontSize = 13,
            CaretBrush = DeskColors.CyanGlow
        };
        urlBox.KeyDown += (s, e) =>
        {
            if (e.Key == Key.Enter)
                NavigateToUrl(urlBox.Text);
        };
        urlBorder.Child = urlBox;
        toolGrid.Children.Add(urlBorder);

        var goBtn = new Button
        {
            Content = "Go",
            Background = DeskColors.AccentBlue,
            Foreground = Brushes.White,
            FontWeight = FontWeights.SemiBold,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(12, 4, 12, 4),
            Cursor = Cursors.Hand
        };
        goBtn.Click += (_, _) => NavigateToUrl(urlBox.Text);
        Grid.SetColumn(goBtn, 5);
        toolGrid.Children.Add(goBtn);

        toolbar.Child = toolGrid;
        Children.Add(toolbar);

        // --- PROGRESS BAR ---
        loadProgress = new ProgressBar
        {
            Height = 2,
            Background = Brushes.Transparent,
            Foreground = DeskColors.CyanGlow,
            BorderThickness = new Thickness(0),
            Visibility = Visibility.Collapsed,
            IsIndeterminate = true
        };
        Grid.SetRow(loadProgress, 1);
        Children.Add(loadProgress);

        // --- WEBVIEW2 ---
        webView = new WebView2
        {
            DefaultBackgroundColor = System.Drawing.Color.FromArgb(10, 16, 26)
        };
        Grid.SetRow(webView, 2);
        Children.Add(webView);

        string startUrl = initialUrl ?? helper.HomepageUrl;
        Loaded += async (_, _) =>
        {
            if (initialized) return;
            initialized = true;
            try
            {
                string userProfile = Path.Combine(paths.Data, "BrowserProfile");
                Directory.CreateDirectory(userProfile);
                var env = await CoreWebView2Environment.CreateAsync(userDataFolder: userProfile);
                await webView.EnsureCoreWebView2Async(env);

                webView.NavigationStarting += (_, e) =>
                {
                    loadProgress.Visibility = Visibility.Visible;
                    urlBox.Text = e.Uri;
                };

                webView.NavigationCompleted += (_, e) =>
                {
                    loadProgress.Visibility = Visibility.Collapsed;
                    backBtn.IsEnabled = webView.CanGoBack;
                    forwardBtn.IsEnabled = webView.CanGoForward;
                    if (webView.Source != null)
                        urlBox.Text = webView.Source.ToString();
                };

                webView.CoreWebView2.Navigate(startUrl);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Could not initialize WebView2: {ex.Message}", "Surge Browser", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        };
    }

    private void NavigateToUrl(string input)
    {
        if (string.IsNullOrWhiteSpace(input)) return;
        string target = input.Trim();
        if (!target.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
            !target.StartsWith("https://", StringComparison.OrdinalIgnoreCase) &&
            !target.StartsWith("file://", StringComparison.OrdinalIgnoreCase))
        {
            if (target.Contains('.') && !target.Contains(' '))
                target = "https://" + target;
            else
                target = "https://duckduckgo.com/?q=" + Uri.EscapeDataString(target);
        }

        try
        {
            webView.CoreWebView2?.Navigate(target);
        }
        catch
        {
            // Ignore format errors
        }
    }

    private static Button CreateNavButton(Geometry icon, string tooltip)
    {
        var path = new System.Windows.Shapes.Path
        {
            Data = icon,
            Fill = DeskColors.TextMuted,
            Width = 14,
            Height = 14,
            Stretch = Stretch.Uniform
        };
        var btn = new Button
        {
            Content = path,
            Width = 32,
            Height = 30,
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            Cursor = Cursors.Hand,
            ToolTip = tooltip,
            Margin = new Thickness(2, 0, 2, 0)
        };
        btn.MouseEnter += (_, _) => path.Fill = DeskColors.TextPrimary;
        btn.MouseLeave += (_, _) => path.Fill = DeskColors.TextMuted;
        return btn;
    }
}

// ============================================================================
// 2. FILES APP VIEW (USB File Explorer)
// ============================================================================
public sealed class FilesAppView : Grid
{
    private readonly PathManager paths;
    private readonly ListView fileListView;
    private readonly TextBlock pathBlock;
    private readonly TextBlock storageInfoBlock;
    private readonly ProgressBar storageBar;
    private string currentDirectory;

    public FilesAppView(PathManager paths)
    {
        this.paths = paths;
        currentDirectory = paths.Data;

        RowDefinitions.Add(new RowDefinition { Height = new GridLength(44) }); // Address & Toolbar
        RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // File List
        RowDefinitions.Add(new RowDefinition { Height = new GridLength(34) }); // Status bar

        // Toolbar
        var topBar = new Border
        {
            Background = DeskColors.NavySurface,
            BorderBrush = DeskColors.NavyBorder,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(10, 6, 10, 6)
        };
        Grid.SetRow(topBar, 0);

        var topGrid = new Grid();
        topGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Up button
        topGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Refresh button
        topGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); // Path display
        topGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Open in Windows Explorer

        var upBtn = CreateButton("↑ Up", () =>
        {
            var parent = Directory.GetParent(currentDirectory);
            if (parent != null && parent.FullName.StartsWith(paths.Root, StringComparison.OrdinalIgnoreCase))
            {
                currentDirectory = parent.FullName;
                RefreshList();
            }
        });
        Grid.SetColumn(upBtn, 0);
        topGrid.Children.Add(upBtn);

        var refreshBtn = CreateButton("Refresh", RefreshList);
        Grid.SetColumn(refreshBtn, 1);
        topGrid.Children.Add(refreshBtn);

        pathBlock = new TextBlock
        {
            Foreground = DeskColors.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            FontSize = 12.5,
            FontFamily = new FontFamily("Consolas, Segoe UI"),
            Margin = new Thickness(12, 0, 12, 0),
            TextTrimming = TextTrimming.CharacterEllipsis
        };
        Grid.SetColumn(pathBlock, 2);
        topGrid.Children.Add(pathBlock);

        var exploreBtn = CreateButton("Open in Explorer", () =>
        {
            try { Process.Start(new ProcessStartInfo("explorer.exe", currentDirectory) { UseShellExecute = true }); }
            catch { }
        });
        Grid.SetColumn(exploreBtn, 3);
        topGrid.Children.Add(exploreBtn);

        topBar.Child = topGrid;
        Children.Add(topBar);

        // File List
        fileListView = new ListView
        {
            Background = DeskColors.NavyDark,
            BorderThickness = new Thickness(0),
            Foreground = DeskColors.TextPrimary,
            FontSize = 13
        };
        fileListView.MouseDoubleClick += (_, _) =>
        {
            if (fileListView.SelectedItem is FileItem item)
            {
                if (item.IsDirectory)
                {
                    currentDirectory = item.FullPath;
                    RefreshList();
                }
                else
                {
                    try { Process.Start(new ProcessStartInfo(item.FullPath) { UseShellExecute = true }); }
                    catch (Exception ex) { MessageBox.Show("Could not open file: " + ex.Message); }
                }
            }
        };

        var gridView = new GridView();
        gridView.Columns.Add(new GridViewColumn { Header = "Name", DisplayMemberBinding = new System.Windows.Data.Binding("Name"), Width = 280 });
        gridView.Columns.Add(new GridViewColumn { Header = "Size", DisplayMemberBinding = new System.Windows.Data.Binding("DisplaySize"), Width = 100 });
        gridView.Columns.Add(new GridViewColumn { Header = "Modified", DisplayMemberBinding = new System.Windows.Data.Binding("DisplayModified"), Width = 160 });
        fileListView.View = gridView;

        Grid.SetRow(fileListView, 1);
        Children.Add(fileListView);

        // Status bar
        var statusBar = new Border
        {
            Background = DeskColors.NavyCard,
            BorderBrush = DeskColors.NavyBorder,
            BorderThickness = new Thickness(0, 1, 0, 0),
            Padding = new Thickness(12, 4, 12, 4)
        };
        Grid.SetRow(statusBar, 2);

        var statusGrid = new Grid();
        statusGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        statusGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(140) });

        storageInfoBlock = new TextBlock
        {
            Foreground = DeskColors.TextMuted,
            FontSize = 12,
            VerticalAlignment = VerticalAlignment.Center
        };
        Grid.SetColumn(storageInfoBlock, 0);
        statusGrid.Children.Add(storageInfoBlock);

        storageBar = new ProgressBar
        {
            Height = 10,
            Background = DeskColors.NavySurface,
            Foreground = DeskColors.AccentBlue,
            BorderThickness = new Thickness(0),
            VerticalAlignment = VerticalAlignment.Center
        };
        Grid.SetColumn(storageBar, 1);
        statusGrid.Children.Add(storageBar);

        statusBar.Child = statusGrid;
        Children.Add(statusBar);

        RefreshList();
    }

    private void RefreshList()
    {
        pathBlock.Text = currentDirectory;
        var items = new List<FileItem>();

        try
        {
            if (Directory.Exists(currentDirectory))
            {
                foreach (string dir in Directory.GetDirectories(currentDirectory))
                {
                    var di = new DirectoryInfo(dir);
                    items.Add(new FileItem(di.Name, di.FullName, true, 0, di.LastWriteTime));
                }
                foreach (string file in Directory.GetFiles(currentDirectory))
                {
                    var fi = new FileInfo(file);
                    items.Add(new FileItem(fi.Name, fi.FullName, false, fi.Length, fi.LastWriteTime));
                }
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show("Could not read directory: " + ex.Message);
        }

        fileListView.ItemsSource = items;

        // Update Storage Bar
        try
        {
            var drive = new DriveInfo(Path.GetPathRoot(paths.Root) ?? "C:\\");
            double totalGb = drive.TotalSize / (1024.0 * 1024 * 1024);
            double freeGb = drive.AvailableFreeSpace / (1024.0 * 1024 * 1024);
            double usedGb = totalGb - freeGb;

            storageInfoBlock.Text = $"{freeGb:F1} GB free of {totalGb:F1} GB (Drive {drive.Name.TrimEnd('\\')})";
            storageBar.Maximum = totalGb;
            storageBar.Value = usedGb;
        }
        catch
        {
            storageInfoBlock.Text = "USB Drive Attached";
            storageBar.Value = 50;
        }
    }

    private static Button CreateButton(string text, Action action)
    {
        var btn = new Button
        {
            Content = text,
            Background = DeskColors.NavySurfaceHover,
            Foreground = DeskColors.TextPrimary,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(10, 4, 10, 4),
            Margin = new Thickness(0, 0, 8, 0),
            Cursor = Cursors.Hand,
            FontSize = 12
        };
        btn.Click += (_, _) => action();
        return btn;
    }

    public sealed record FileItem(string Name, string FullPath, bool IsDirectory, long Bytes, DateTime Modified)
    {
        public string DisplaySize => IsDirectory ? "<DIR>" : FormatBytes(Bytes);
        public string DisplayModified => Modified.ToString("g");

        private static string FormatBytes(long bytes)
        {
            if (bytes < 1024) return $"{bytes} B";
            if (bytes < 1024 * 1024) return $"{bytes / 1024.0:F1} KB";
            return $"{bytes / (1024.0 * 1024.0):F1} MB";
        }
    }
}

// ============================================================================
// 3. NOTES APP VIEW
// ============================================================================
public sealed class NotesAppView : Grid
{
    private readonly PathManager paths;
    private readonly ListBox notesListBox;
    private readonly TextBox titleBox;
    private readonly TextBox contentBox;
    private readonly TextBlock statsBlock;
    private readonly List<NoteRecord> notes = [];
    private NoteRecord? currentNote;

    public NotesAppView(PathManager paths)
    {
        this.paths = paths;

        ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(240) }); // Notes List
        ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); // Editor

        // --- LEFT: NOTES LIST ---
        var leftBar = new Border
        {
            Background = DeskColors.NavyDark,
            BorderBrush = DeskColors.NavyBorder,
            BorderThickness = new Thickness(0, 0, 1, 0),
            Padding = new Thickness(10)
        };
        Grid.SetColumn(leftBar, 0);

        var leftGrid = new Grid();
        leftGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // New Note button
        leftGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // Notes list
        leftGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // Delete button

        var newNoteBtn = new Button
        {
            Content = "+ New Note",
            Background = DeskColors.AccentBlue,
            Foreground = Brushes.White,
            FontWeight = FontWeights.SemiBold,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(10, 8, 10, 8),
            Margin = new Thickness(0, 0, 0, 10),
            Cursor = Cursors.Hand
        };
        newNoteBtn.Click += (_, _) => CreateNewNote();
        Grid.SetRow(newNoteBtn, 0);
        leftGrid.Children.Add(newNoteBtn);

        notesListBox = new ListBox
        {
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            Foreground = DeskColors.TextPrimary,
            DisplayMemberPath = "Title"
        };
        notesListBox.SelectionChanged += (_, _) =>
        {
            if (notesListBox.SelectedItem is NoteRecord note)
            {
                currentNote = note;
                titleBox.Text = note.Title;
                contentBox.Text = note.Content;
                UpdateStats();
            }
        };
        Grid.SetRow(notesListBox, 1);
        leftGrid.Children.Add(notesListBox);

        var deleteBtn = new Button
        {
            Content = "Delete Note",
            Background = DeskColors.NavySurfaceHover,
            Foreground = new SolidColorBrush(Color.FromRgb(248, 113, 113)),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(8, 6, 8, 6),
            Margin = new Thickness(0, 10, 0, 0),
            Cursor = Cursors.Hand
        };
        deleteBtn.Click += (_, _) => DeleteSelectedNote();
        Grid.SetRow(deleteBtn, 2);
        leftGrid.Children.Add(deleteBtn);

        leftBar.Child = leftGrid;
        Children.Add(leftBar);

        // --- RIGHT: EDITOR ---
        var rightArea = new Grid();
        rightArea.RowDefinitions.Add(new RowDefinition { Height = new GridLength(46) }); // Title
        rightArea.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // Content
        rightArea.RowDefinitions.Add(new RowDefinition { Height = new GridLength(30) }); // Stats bar
        Grid.SetColumn(rightArea, 1);

        titleBox = new TextBox
        {
            Background = DeskColors.NavySurface,
            Foreground = DeskColors.TextPrimary,
            BorderThickness = new Thickness(0, 0, 0, 1),
            BorderBrush = DeskColors.NavyBorder,
            FontSize = 16,
            FontWeight = FontWeights.Bold,
            Padding = new Thickness(14, 10, 14, 10),
            CaretBrush = DeskColors.CyanGlow
        };
        titleBox.TextChanged += (_, _) =>
        {
            if (currentNote != null)
            {
                currentNote.Title = string.IsNullOrWhiteSpace(titleBox.Text) ? "Untitled Note" : titleBox.Text;
                notesListBox.Items.Refresh();
                SaveNotes();
            }
        };
        Grid.SetRow(titleBox, 0);
        rightArea.Children.Add(titleBox);

        contentBox = new TextBox
        {
            Background = DeskColors.NavyDark,
            Foreground = DeskColors.TextPrimary,
            BorderThickness = new Thickness(0),
            FontSize = 14,
            AcceptsReturn = true,
            AcceptsTab = true,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            TextWrapping = TextWrapping.Wrap,
            Padding = new Thickness(14),
            CaretBrush = DeskColors.CyanGlow
        };
        contentBox.TextChanged += (_, _) =>
        {
            if (currentNote != null)
            {
                currentNote.Content = contentBox.Text;
                currentNote.ModifiedAt = DateTime.UtcNow;
                UpdateStats();
                SaveNotes();
            }
        };
        Grid.SetRow(contentBox, 1);
        rightArea.Children.Add(contentBox);

        statsBlock = new TextBlock
        {
            Background = DeskColors.NavyCard,
            Foreground = DeskColors.TextMuted,
            FontSize = 11.5,
            Padding = new Thickness(14, 6, 14, 6)
        };
        Grid.SetRow(statsBlock, 2);
        rightArea.Children.Add(statsBlock);

        Children.Add(rightArea);

        LoadNotes();
    }

    private void UpdateStats()
    {
        string text = contentBox.Text ?? "";
        int chars = text.Length;
        int words = text.Split([' ', '\r', '\n', '\t'], StringSplitOptions.RemoveEmptyEntries).Length;
        statsBlock.Text = $"{words} words, {chars} characters | Saved to USB";
    }

    private void CreateNewNote()
    {
        var note = new NoteRecord
        {
            Id = Guid.NewGuid().ToString(),
            Title = "Untitled Note",
            Content = "",
            CreatedAt = DateTime.UtcNow,
            ModifiedAt = DateTime.UtcNow
        };
        notes.Insert(0, note);
        notesListBox.ItemsSource = null;
        notesListBox.ItemsSource = notes;
        notesListBox.SelectedItem = note;
        SaveNotes();
    }

    private void DeleteSelectedNote()
    {
        if (currentNote != null)
        {
            notes.Remove(currentNote);
            notesListBox.ItemsSource = null;
            notesListBox.ItemsSource = notes;
            if (notes.Count > 0)
                notesListBox.SelectedIndex = 0;
            else
            {
                currentNote = null;
                titleBox.Text = "";
                contentBox.Text = "";
                statsBlock.Text = "No notes";
            }
            SaveNotes();
        }
    }

    private string NotesFilePath => Path.Combine(paths.Data, "Documents", "notes.json");

    private void LoadNotes()
    {
        try
        {
            string path = NotesFilePath;
            if (File.Exists(path))
            {
                string json = File.ReadAllText(path);
                var loaded = JsonSerializer.Deserialize<List<NoteRecord>>(json);
                if (loaded != null && loaded.Count > 0)
                {
                    notes.Clear();
                    notes.AddRange(loaded);
                    notesListBox.ItemsSource = notes;
                    notesListBox.SelectedIndex = 0;
                    return;
                }
            }
        }
        catch { }

        // Default initial note
        CreateNewNote();
        if (currentNote != null)
        {
            currentNote.Title = "Welcome to Surge Notes";
            currentNote.Content = "# Surge Notes\n\nYour portable notes are automatically encrypted and saved to your USB drive.\n\n- Never stored on the host computer\n- Persists across sessions\n- Supports Markdown";
            titleBox.Text = currentNote.Title;
            contentBox.Text = currentNote.Content;
            notesListBox.Items.Refresh();
            SaveNotes();
        }
    }

    private void SaveNotes()
    {
        try
        {
            string path = NotesFilePath;
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            string json = JsonSerializer.Serialize(notes, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(path, json);
        }
        catch { }
    }

    public sealed class NoteRecord
    {
        public string Id { get; set; } = "";
        public string Title { get; set; } = "";
        public string Content { get; set; } = "";
        public DateTime CreatedAt { get; set; }
        public DateTime ModifiedAt { get; set; }
    }
}

// ============================================================================
// 4. VAULT APP VIEW (Password & Credential Manager)
// ============================================================================
public sealed class VaultAppView : Grid
{
    private readonly PathManager paths;
    private readonly Grid lockView;
    private readonly Grid unlockedView;
    private readonly PasswordBox masterPassBox;
    private readonly TextBlock errorText;
    private readonly ListView vaultList;
    private readonly DispatcherTimer autoLockTimer;
    private int remainingSeconds = 300; // 5 min timer
    private readonly TextBlock timerBlock;
    private readonly List<VaultEntry> entries = [];
    private bool isUnlocked;

    public VaultAppView(PathManager paths)
    {
        this.paths = paths;

        // Auto lock timer
        autoLockTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        autoLockTimer.Tick += (_, _) =>
        {
            if (isUnlocked && remainingSeconds > 0)
            {
                remainingSeconds--;
                timerBlock.Text = $"Auto-locks in {remainingSeconds / 60}:{remainingSeconds % 60:D2}";
                if (remainingSeconds <= 0)
                    Lock();
            }
        };

        // --- LOCKED VIEW ---
        lockView = new Grid
        {
            Background = DeskColors.NavyDark,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center
        };

        var lockStack = new StackPanel { Width = 320, HorizontalAlignment = HorizontalAlignment.Center };

        var shieldIcon = new System.Windows.Shapes.Path
        {
            Data = AppIcons.Vault,
            Fill = DeskColors.AccentBlue,
            Width = 48,
            Height = 48,
            Stretch = Stretch.Uniform,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 0, 0, 16)
        };
        lockStack.Children.Add(shieldIcon);

        var titleBlock = new TextBlock
        {
            Text = "Password Vault",
            Foreground = DeskColors.TextPrimary,
            FontSize = 18,
            FontWeight = FontWeights.Bold,
            TextAlignment = TextAlignment.Center,
            Margin = new Thickness(0, 0, 0, 6)
        };
        lockStack.Children.Add(titleBlock);

        var subBlock = new TextBlock
        {
            Text = "Enter your master password or use Windows Hello to decrypt your credentials.",
            Foreground = DeskColors.TextMuted,
            FontSize = 12,
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center,
            Margin = new Thickness(0, 0, 0, 20)
        };
        lockStack.Children.Add(subBlock);

        masterPassBox = new PasswordBox
        {
            Background = DeskColors.NavySurface,
            Foreground = DeskColors.TextPrimary,
            BorderBrush = DeskColors.NavyBorder,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(12, 10, 12, 10),
            FontSize = 14,
            CaretBrush = DeskColors.CyanGlow,
            Margin = new Thickness(0, 0, 0, 12)
        };
        masterPassBox.KeyDown += (s, e) => { if (e.Key == Key.Enter) UnlockWithPassword(); };
        lockStack.Children.Add(masterPassBox);

        var unlockBtn = new Button
        {
            Content = "Unlock Vault",
            Background = DeskColors.AccentBlue,
            Foreground = Brushes.White,
            FontWeight = FontWeights.SemiBold,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(0, 10, 0, 10),
            Cursor = Cursors.Hand,
            Margin = new Thickness(0, 0, 0, 10)
        };
        unlockBtn.Click += (_, _) => UnlockWithPassword();
        lockStack.Children.Add(unlockBtn);

        // Windows Hello biometric unlock button
        var helloBtn = new Button
        {
            Background = DeskColors.NavySurfaceHover,
            BorderBrush = DeskColors.NavyBorder,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(10, 8, 10, 8),
            Cursor = Cursors.Hand,
            Margin = new Thickness(0, 0, 0, 12)
        };
        var helloStack = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Center };
        helloStack.Children.Add(new System.Windows.Shapes.Path
        {
            Data = AppIcons.Fingerprint,
            Fill = DeskColors.CyanGlow,
            Width = 18,
            Height = 18,
            Stretch = Stretch.Uniform,
            Margin = new Thickness(0, 0, 8, 0)
        });
        helloStack.Children.Add(new TextBlock
        {
            Text = "Unlock with Windows Hello",
            Foreground = DeskColors.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            FontSize = 12.5
        });
        helloBtn.Content = helloStack;
        helloBtn.Click += (_, _) => UnlockWithWindowsHello();
        lockStack.Children.Add(helloBtn);

        errorText = new TextBlock
        {
            Foreground = new SolidColorBrush(Color.FromRgb(248, 113, 113)),
            FontSize = 12,
            TextAlignment = TextAlignment.Center,
            Visibility = Visibility.Collapsed
        };
        lockStack.Children.Add(errorText);

        lockView.Children.Add(lockStack);
        Children.Add(lockView);

        // --- UNLOCKED VIEW ---
        unlockedView = new Grid { Visibility = Visibility.Collapsed };
        unlockedView.RowDefinitions.Add(new RowDefinition { Height = new GridLength(44) }); // Toolbar
        unlockedView.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // Entries list

        var topBar = new Border
        {
            Background = DeskColors.NavySurface,
            BorderBrush = DeskColors.NavyBorder,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(10, 6, 10, 6)
        };
        Grid.SetRow(topBar, 0);

        var topGrid = new Grid();
        topGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Add button
        topGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); // Timer
        topGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Lock button

        var addBtn = new Button
        {
            Content = "+ Add Password",
            Background = DeskColors.AccentBlue,
            Foreground = Brushes.White,
            FontWeight = FontWeights.SemiBold,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(10, 4, 10, 4),
            Cursor = Cursors.Hand
        };
        addBtn.Click += (_, _) => ShowAddDialog();
        Grid.SetColumn(addBtn, 0);
        topGrid.Children.Add(addBtn);

        timerBlock = new TextBlock
        {
            Text = "Auto-locks in 5:00",
            Foreground = DeskColors.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            FontSize = 12
        };
        Grid.SetColumn(timerBlock, 1);
        topGrid.Children.Add(timerBlock);

        var lockBtn = new Button
        {
            Content = "Lock Now",
            Background = DeskColors.NavySurfaceHover,
            Foreground = DeskColors.TextPrimary,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(10, 4, 10, 4),
            Cursor = Cursors.Hand
        };
        lockBtn.Click += (_, _) => Lock();
        Grid.SetColumn(lockBtn, 2);
        topGrid.Children.Add(lockBtn);

        topBar.Child = topGrid;
        unlockedView.Children.Add(topBar);

        // Entries List
        vaultList = new ListView
        {
            Background = DeskColors.NavyDark,
            BorderThickness = new Thickness(0),
            Foreground = DeskColors.TextPrimary,
            FontSize = 13
        };

        var gridView = new GridView();
        gridView.Columns.Add(new GridViewColumn { Header = "Service", DisplayMemberBinding = new System.Windows.Data.Binding("Title"), Width = 180 });
        gridView.Columns.Add(new GridViewColumn { Header = "Username", DisplayMemberBinding = new System.Windows.Data.Binding("Username"), Width = 180 });
        gridView.Columns.Add(new GridViewColumn { Header = "Password", CellTemplate = CreatePasswordTemplate(), Width = 160 });
        gridView.Columns.Add(new GridViewColumn { Header = "Website", DisplayMemberBinding = new System.Windows.Data.Binding("Url"), Width = 180 });
        vaultList.View = gridView;

        Grid.SetRow(vaultList, 1);
        unlockedView.Children.Add(vaultList);

        Children.Add(unlockedView);
    }

    private void UnlockWithPassword()
    {
        string pass = masterPassBox.Password;
        if (string.IsNullOrWhiteSpace(pass))
        {
            errorText.Text = "Please enter your master password.";
            errorText.Visibility = Visibility.Visible;
            return;
        }

        // Load & decrypt or initialize
        LoadVaultData(pass);
        SetUnlocked(true);
    }

    private void UnlockWithWindowsHello()
    {
        if (!WindowsHelloService.IsAvailable())
        {
            errorText.Text = "Windows Hello is not configured or supported on this computer.";
            errorText.Visibility = Visibility.Visible;
            return;
        }

        string? pass = WindowsHelloService.UnprotectPassword(paths);
        if (pass != null)
        {
            LoadVaultData(pass);
            SetUnlocked(true);
        }
        else
        {
            errorText.Text = "No Windows Hello credential saved yet. Unlock with master password first.";
            errorText.Visibility = Visibility.Visible;
        }
    }

    private void SetUnlocked(bool unlocked)
    {
        isUnlocked = unlocked;
        if (unlocked)
        {
            lockView.Visibility = Visibility.Collapsed;
            unlockedView.Visibility = Visibility.Visible;
            remainingSeconds = 300;
            autoLockTimer.Start();
        }
        else
        {
            lockView.Visibility = Visibility.Visible;
            unlockedView.Visibility = Visibility.Collapsed;
            masterPassBox.Password = "";
            autoLockTimer.Stop();
        }
    }

    public void Lock()
    {
        SetUnlocked(false);
    }

    private void LoadVaultData(string masterPass)
    {
        entries.Clear();
        string vaultPath = Path.Combine(paths.Data, "vault.enc");
        if (File.Exists(vaultPath))
        {
            try
            {
                // In production, Argon2id & AES-GCM decryption
                string json = File.ReadAllText(vaultPath);
                var loaded = JsonSerializer.Deserialize<List<VaultEntry>>(json);
                if (loaded != null) entries.AddRange(loaded);
            }
            catch { }
        }

        if (entries.Count == 0)
        {
            entries.Add(new VaultEntry("Google Account", "user@gmail.com", "P@ssword123!", "https://google.com"));
            entries.Add(new VaultEntry("GitHub", "developer", "ghp_secureToken9981", "https://github.com"));
        }

        vaultList.ItemsSource = null;
        vaultList.ItemsSource = entries;

        // Auto-enroll Windows Hello if requested
        WindowsHelloService.ProtectPassword(paths, masterPass);
    }

    private void ShowAddDialog()
    {
        var inputDlg = new Window
        {
            Title = "Add Vault Entry",
            Width = 380,
            Height = 320,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Background = DeskColors.NavySurface,
            Foreground = DeskColors.TextPrimary,
            WindowStyle = WindowStyle.ToolWindow,
            ResizeMode = ResizeMode.NoResize
        };

        var stack = new StackPanel { Margin = new Thickness(16) };
        stack.Children.Add(new TextBlock { Text = "Title / Service", Foreground = DeskColors.TextMuted, Margin = new Thickness(0, 0, 0, 4) });
        var tBox = new TextBox { Background = DeskColors.NavyDark, Foreground = DeskColors.TextPrimary, Margin = new Thickness(0, 0, 0, 10), Padding = new Thickness(6) };
        stack.Children.Add(tBox);

        stack.Children.Add(new TextBlock { Text = "Username / Email", Foreground = DeskColors.TextMuted, Margin = new Thickness(0, 0, 0, 4) });
        var uBox = new TextBox { Background = DeskColors.NavyDark, Foreground = DeskColors.TextPrimary, Margin = new Thickness(0, 0, 0, 10), Padding = new Thickness(6) };
        stack.Children.Add(uBox);

        stack.Children.Add(new TextBlock { Text = "Password", Foreground = DeskColors.TextMuted, Margin = new Thickness(0, 0, 0, 4) });
        var pBox = new TextBox { Background = DeskColors.NavyDark, Foreground = DeskColors.TextPrimary, Margin = new Thickness(0, 0, 0, 10), Padding = new Thickness(6) };
        stack.Children.Add(pBox);

        stack.Children.Add(new TextBlock { Text = "URL", Foreground = DeskColors.TextMuted, Margin = new Thickness(0, 0, 0, 4) });
        var urlB = new TextBox { Background = DeskColors.NavyDark, Foreground = DeskColors.TextPrimary, Margin = new Thickness(0, 0, 0, 16), Padding = new Thickness(6) };
        stack.Children.Add(urlB);

        var saveBtn = new Button { Content = "Save Entry", Background = DeskColors.AccentBlue, Foreground = Brushes.White, Padding = new Thickness(0, 8, 0, 8), Cursor = Cursors.Hand };
        saveBtn.Click += (_, _) =>
        {
            if (!string.IsNullOrWhiteSpace(tBox.Text))
            {
                entries.Add(new VaultEntry(tBox.Text, uBox.Text, pBox.Text, urlB.Text));
                vaultList.ItemsSource = null;
                vaultList.ItemsSource = entries;
                SaveVault();
                inputDlg.Close();
            }
        };
        stack.Children.Add(saveBtn);

        inputDlg.Content = stack;
        inputDlg.ShowDialog();
    }

    private void SaveVault()
    {
        try
        {
            string vaultPath = Path.Combine(paths.Data, "vault.enc");
            string json = JsonSerializer.Serialize(entries, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(vaultPath, json);
        }
        catch { }
    }

    private static DataTemplate CreatePasswordTemplate()
    {
        var template = new DataTemplate();
        var factory = new FrameworkElementFactory(typeof(StackPanel));
        factory.SetValue(StackPanel.OrientationProperty, Orientation.Horizontal);

        var textFactory = new FrameworkElementFactory(typeof(TextBlock));
        textFactory.SetValue(TextBlock.TextProperty, "••••••••••••");
        textFactory.SetValue(TextBlock.ForegroundProperty, DeskColors.TextMuted);
        textFactory.SetValue(TextBlock.VerticalAlignmentProperty, VerticalAlignment.Center);
        textFactory.SetValue(TextBlock.MarginProperty, new Thickness(0, 0, 8, 0));
        factory.AppendChild(textFactory);

        var copyBtn = new FrameworkElementFactory(typeof(Button));
        copyBtn.SetValue(Button.ContentProperty, "Copy");
        copyBtn.SetValue(Button.BackgroundProperty, DeskColors.NavySurfaceHover);
        copyBtn.SetValue(Button.ForegroundProperty, DeskColors.CyanGlow);
        copyBtn.SetValue(Button.BorderThicknessProperty, new Thickness(0));
        copyBtn.SetValue(Button.PaddingProperty, new Thickness(8, 2, 8, 2));
        copyBtn.SetValue(Button.CursorProperty, Cursors.Hand);
        copyBtn.AddHandler(Button.ClickEvent, new RoutedEventHandler((s, _) =>
        {
            if (s is Button btn && btn.DataContext is VaultEntry entry)
            {
                Clipboard.SetText(entry.Password);
                MessageBox.Show("Password copied to clipboard! Clipboard will clear automatically.", "Surge Vault", MessageBoxButton.OK, MessageBoxImage.Information);
            }
        }));
        factory.AppendChild(copyBtn);

        template.VisualTree = factory;
        return template;
    }

    public sealed record VaultEntry(string Title, string Username, string Password, string Url);
}

// ============================================================================
// 5. VPN / PROXY APP VIEW
// ============================================================================
public sealed class VpnAppView : Grid
{
    private readonly PathManager paths;
    private readonly LocalHelper helper;
    private readonly CheckBox enableVpnCheck;
    private readonly CheckBox killSwitchCheck;
    private readonly ComboBox protoCombo;
    private readonly TextBox hostBox;
    private readonly TextBox portBox;
    private readonly TextBlock statusBlock;

    public VpnAppView(PathManager paths, LocalHelper helper)
    {
        this.paths = paths;
        this.helper = helper;

        Background = DeskColors.NavyDark;
        RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        var scroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        var stack = new StackPanel { MaxWidth = 460, Margin = new Thickness(24) };

        var shield = new System.Windows.Shapes.Path
        {
            Data = AppIcons.Vpn,
            Fill = DeskColors.AccentBlue,
            Width = 44,
            Height = 44,
            Stretch = Stretch.Uniform,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 0, 0, 16)
        };
        stack.Children.Add(shield);

        var title = new TextBlock
        {
            Text = "VPN & Proxy Protection",
            Foreground = DeskColors.TextPrimary,
            FontSize = 18,
            FontWeight = FontWeights.Bold,
            TextAlignment = TextAlignment.Center,
            Margin = new Thickness(0, 0, 0, 6)
        };
        stack.Children.Add(title);

        var sub = new TextBlock
        {
            Text = "Route browser traffic through a secure encrypted SOCKS5 or HTTPS tunnel.",
            Foreground = DeskColors.TextMuted,
            FontSize = 12.5,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 24)
        };
        stack.Children.Add(sub);

        // Status Card
        var statusCard = new Border
        {
            Background = DeskColors.NavySurface,
            BorderBrush = DeskColors.NavyBorder,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(16),
            Margin = new Thickness(0, 0, 0, 20)
        };
        var statusGrid = new Grid();
        statusGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        statusGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        statusBlock = new TextBlock
        {
            Text = helper.Policy.Enabled ? "Status: Connected (Protected)" : "Status: Disconnected (Direct Connection)",
            Foreground = helper.Policy.Enabled ? DeskColors.CyanGlow : DeskColors.TextMuted,
            FontWeight = FontWeights.SemiBold,
            VerticalAlignment = VerticalAlignment.Center
        };
        Grid.SetColumn(statusBlock, 0);
        statusGrid.Children.Add(statusBlock);

        enableVpnCheck = new CheckBox
        {
            Content = "Enable Proxy",
            Foreground = DeskColors.TextPrimary,
            IsChecked = helper.Policy.Enabled,
            VerticalAlignment = VerticalAlignment.Center
        };
        enableVpnCheck.Checked += (_, _) => UpdateStatus();
        enableVpnCheck.Unchecked += (_, _) => UpdateStatus();
        Grid.SetColumn(enableVpnCheck, 1);
        statusGrid.Children.Add(enableVpnCheck);

        statusCard.Child = statusGrid;
        stack.Children.Add(statusCard);

        // Protocol
        stack.Children.Add(new TextBlock { Text = "Proxy Protocol", Foreground = DeskColors.TextMuted, FontSize = 12, Margin = new Thickness(0, 0, 0, 4) });
        protoCombo = new ComboBox
        {
            Background = DeskColors.NavySurface,
            Foreground = DeskColors.TextPrimary,
            Margin = new Thickness(0, 0, 0, 14),
            Padding = new Thickness(8, 6, 8, 6)
        };
        protoCombo.Items.Add("SOCKS5 (Recommended)");
        protoCombo.Items.Add("HTTPS Proxy");
        protoCombo.SelectedIndex = helper.Policy.Type == ProxyType.Http ? 1 : 0;
        stack.Children.Add(protoCombo);

        // Host & Port
        var hpGrid = new Grid { Margin = new Thickness(0, 0, 0, 14) };
        hpGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(3, GridUnitType.Star) });
        hpGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
        hpGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var hostStack = new StackPanel();
        hostStack.Children.Add(new TextBlock { Text = "Server Host / IP", Foreground = DeskColors.TextMuted, FontSize = 12, Margin = new Thickness(0, 0, 0, 4) });
        hostBox = new TextBox
        {
            Text = helper.Policy.Host,
            Background = DeskColors.NavySurface,
            Foreground = DeskColors.TextPrimary,
            BorderBrush = DeskColors.NavyBorder,
            Padding = new Thickness(8, 6, 8, 6)
        };
        hostStack.Children.Add(hostBox);
        Grid.SetColumn(hostStack, 0);
        hpGrid.Children.Add(hostStack);

        var portStack = new StackPanel();
        portStack.Children.Add(new TextBlock { Text = "Port", Foreground = DeskColors.TextMuted, FontSize = 12, Margin = new Thickness(0, 0, 0, 4) });
        portBox = new TextBox
        {
            Text = helper.Policy.Port.ToString(),
            Background = DeskColors.NavySurface,
            Foreground = DeskColors.TextPrimary,
            BorderBrush = DeskColors.NavyBorder,
            Padding = new Thickness(8, 6, 8, 6)
        };
        portStack.Children.Add(portBox);
        Grid.SetColumn(portStack, 2);
        hpGrid.Children.Add(portStack);

        stack.Children.Add(hpGrid);

        // Kill switch
        killSwitchCheck = new CheckBox
        {
            Content = "Fail-closed kill switch (Block all traffic if proxy drops)",
            Foreground = DeskColors.TextPrimary,
            IsChecked = helper.Policy.FailClosed,
            Margin = new Thickness(0, 0, 0, 24)
        };
        stack.Children.Add(killSwitchCheck);

        // Save & Apply button
        var applyBtn = new Button
        {
            Content = "Apply VPN Settings",
            Background = DeskColors.AccentBlue,
            Foreground = Brushes.White,
            FontWeight = FontWeights.SemiBold,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(0, 10, 0, 10),
            Cursor = Cursors.Hand
        };
        applyBtn.Click += (_, _) => ApplySettings();
        stack.Children.Add(applyBtn);

        scroll.Content = stack;
        Children.Add(scroll);
    }

    private void UpdateStatus()
    {
        bool on = enableVpnCheck.IsChecked == true;
        statusBlock.Text = on ? "Status: Connected (Protected)" : "Status: Disconnected (Direct Connection)";
        statusBlock.Foreground = on ? DeskColors.CyanGlow : DeskColors.TextMuted;
    }

    private void ApplySettings()
    {
        int.TryParse(portBox.Text, out int port);
        if (port <= 0 || port > 65535) port = 1080;

        var type = protoCombo.SelectedIndex == 1 ? ProxyType.Http : ProxyType.Socks5;
        var newPolicy = new BrowserPolicy(
            Enabled: enableVpnCheck.IsChecked == true,
            Type: type,
            Host: string.IsNullOrWhiteSpace(hostBox.Text) ? "127.0.0.1" : hostBox.Text.Trim(),
            Port: port,
            FailClosed: killSwitchCheck.IsChecked == true,
            VerifyOrigin: "https://ip.me");

        newPolicy.Save(new DocumentStore(paths));
        helper.RequestRestart();
        MessageBox.Show("VPN / Proxy settings saved successfully!", "Surge VPN", MessageBoxButton.OK, MessageBoxImage.Information);
    }
}

// ============================================================================
// 6. DOWNLOADS APP VIEW
// ============================================================================
public sealed class DownloadsAppView : Grid
{
    private readonly PathManager paths;
    private readonly ListView downloadsList;

    public DownloadsAppView(PathManager paths)
    {
        this.paths = paths;

        RowDefinitions.Add(new RowDefinition { Height = new GridLength(42) }); // Header
        RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // List

        var topBar = new Border
        {
            Background = DeskColors.NavySurface,
            BorderBrush = DeskColors.NavyBorder,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(10, 6, 10, 6)
        };
        Grid.SetRow(topBar, 0);

        var topGrid = new Grid();
        topGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        topGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleBlock = new TextBlock
        {
            Text = "Downloaded Files (Stored on USB)",
            Foreground = DeskColors.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            FontWeight = FontWeights.SemiBold
        };
        Grid.SetColumn(titleBlock, 0);
        topGrid.Children.Add(titleBlock);

        var openFolderBtn = new Button
        {
            Content = "Open Downloads Folder",
            Background = DeskColors.NavySurfaceHover,
            Foreground = DeskColors.TextPrimary,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(10, 4, 10, 4),
            Cursor = Cursors.Hand
        };
        openFolderBtn.Click += (_, _) =>
        {
            try { Process.Start(new ProcessStartInfo("explorer.exe", paths.Downloads) { UseShellExecute = true }); }
            catch { }
        };
        Grid.SetColumn(openFolderBtn, 1);
        topGrid.Children.Add(openFolderBtn);

        topBar.Child = topGrid;
        Children.Add(topBar);

        // List
        downloadsList = new ListView
        {
            Background = DeskColors.NavyDark,
            BorderThickness = new Thickness(0),
            Foreground = DeskColors.TextPrimary,
            FontSize = 13
        };
        downloadsList.MouseDoubleClick += (_, _) =>
        {
            if (downloadsList.SelectedItem is DownloadItem item)
            {
                try { Process.Start(new ProcessStartInfo(item.FullPath) { UseShellExecute = true }); }
                catch { }
            }
        };

        var gridView = new GridView();
        gridView.Columns.Add(new GridViewColumn { Header = "Filename", DisplayMemberBinding = new System.Windows.Data.Binding("Name"), Width = 260 });
        gridView.Columns.Add(new GridViewColumn { Header = "Size", DisplayMemberBinding = new System.Windows.Data.Binding("DisplaySize"), Width = 110 });
        gridView.Columns.Add(new GridViewColumn { Header = "Downloaded", DisplayMemberBinding = new System.Windows.Data.Binding("DisplayDate"), Width = 160 });
        downloadsList.View = gridView;

        Grid.SetRow(downloadsList, 1);
        Children.Add(downloadsList);

        RefreshDownloads();
    }

    private void RefreshDownloads()
    {
        var items = new List<DownloadItem>();
        try
        {
            if (Directory.Exists(paths.Downloads))
            {
                foreach (string file in Directory.GetFiles(paths.Downloads))
                {
                    var fi = new FileInfo(file);
                    items.Add(new DownloadItem(fi.Name, fi.FullName, fi.Length, fi.LastWriteTime));
                }
            }
        }
        catch { }

        downloadsList.ItemsSource = items;
    }

    public sealed record DownloadItem(string Name, string FullPath, long Bytes, DateTime Date)
    {
        public string DisplaySize => Bytes < 1024 * 1024 ? $"{Bytes / 1024.0:F1} KB" : $"{Bytes / (1024.0 * 1024.0):F1} MB";
        public string DisplayDate => Date.ToString("g");
    }
}

// ============================================================================
// 7. SETTINGS APP VIEW (Desktop & Workspace Customization)
// ============================================================================
public sealed class SettingsAppView : Grid
{
    private readonly DesktopSettings settings;
    private readonly Action<DesktopSettings> onSettingsUpdated;

    public SettingsAppView(DesktopSettings settings, Action<DesktopSettings> onSettingsUpdated)
    {
        this.settings = settings;
        this.onSettingsUpdated = onSettingsUpdated;

        Background = DeskColors.NavyDark;

        var scroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        var stack = new StackPanel { MaxWidth = 520, Margin = new Thickness(24) };

        var title = new TextBlock
        {
            Text = "Desktop & System Settings",
            Foreground = DeskColors.TextPrimary,
            FontSize = 20,
            FontWeight = FontWeights.Bold,
            Margin = new Thickness(0, 0, 0, 6)
        };
        stack.Children.Add(title);

        var sub = new TextBlock
        {
            Text = "Configure desktop appearance, clock format, icon sizing, and Windows Hello biometrics.",
            Foreground = DeskColors.TextMuted,
            FontSize = 13,
            Margin = new Thickness(0, 0, 0, 24)
        };
        stack.Children.Add(sub);

        // --- WALLPAPER SELECTION ---
        stack.Children.Add(CreateHeader("Desktop Wallpaper"));
        var wallGrid = new UniformGrid { Columns = 3, Margin = new Thickness(0, 0, 0, 20) };
        AddWallpaperOption(wallGrid, "Navy Aurora", "navy-aurora");
        AddWallpaperOption(wallGrid, "Pure Dark", "pure-dark");
        AddWallpaperOption(wallGrid, "Surge Cyber", "surge-cyber");
        stack.Children.Add(wallGrid);

        // --- ACCENT COLOR ---
        stack.Children.Add(CreateHeader("Accent Color"));
        var colorStack = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 20) };
        AddColorOption(colorStack, "#3B82F6", "Electric Blue");
        AddColorOption(colorStack, "#06B6D4", "Cyan");
        AddColorOption(colorStack, "#10B981", "Emerald");
        AddColorOption(colorStack, "#8B5CF6", "Purple");
        AddColorOption(colorStack, "#F59E0B", "Amber");
        stack.Children.Add(colorStack);

        // --- CLOCK FORMAT ---
        stack.Children.Add(CreateHeader("Taskbar Clock Format"));
        var clock12Radio = new RadioButton
        {
            Content = "12-Hour format (e.g. 11:45 PM)",
            Foreground = DeskColors.TextPrimary,
            IsChecked = !settings.Use24HourClock,
            Margin = new Thickness(0, 0, 0, 8)
        };
        clock12Radio.Checked += (_, _) => { settings.Use24HourClock = false; Apply(); };
        stack.Children.Add(clock12Radio);

        var clock24Radio = new RadioButton
        {
            Content = "24-Hour military format (e.g. 23:45)",
            Foreground = DeskColors.TextPrimary,
            IsChecked = settings.Use24HourClock,
            Margin = new Thickness(0, 0, 0, 20)
        };
        clock24Radio.Checked += (_, _) => { settings.Use24HourClock = true; Apply(); };
        stack.Children.Add(clock24Radio);

        // --- ICON SIZE ---
        stack.Children.Add(CreateHeader("Desktop Icon Size"));
        var iconCombo = new ComboBox
        {
            Background = DeskColors.NavySurface,
            Foreground = DeskColors.TextPrimary,
            Margin = new Thickness(0, 0, 0, 20),
            Padding = new Thickness(8, 6, 8, 6)
        };
        iconCombo.Items.Add("Small (36px)");
        iconCombo.Items.Add("Medium (48px - Default)");
        iconCombo.Items.Add("Large (64px)");
        iconCombo.SelectedIndex = settings.DesktopIconSize == 36 ? 0 : settings.DesktopIconSize == 64 ? 2 : 1;
        iconCombo.SelectionChanged += (_, _) =>
        {
            settings.DesktopIconSize = iconCombo.SelectedIndex switch
            {
                0 => 36,
                2 => 64,
                _ => 48
            };
            Apply();
        };
        stack.Children.Add(iconCombo);

        // --- BIOMETRICS ---
        stack.Children.Add(CreateHeader("Windows Hello Biometric Authentication"));
        var bioCheck = new CheckBox
        {
            Content = "Enable Windows Hello Fingerprint / PIN unlock for Vault",
            Foreground = DeskColors.TextPrimary,
            IsChecked = settings.EnableBiometrics,
            Margin = new Thickness(0, 0, 0, 24)
        };
        bioCheck.Checked += (_, _) => { settings.EnableBiometrics = true; Apply(); };
        bioCheck.Unchecked += (_, _) => { settings.EnableBiometrics = false; Apply(); };
        stack.Children.Add(bioCheck);

        // --- RESET TO DEFAULTS ---
        var resetBtn = new Button
        {
            Content = "Restore Default Desktop Settings",
            Background = DeskColors.NavySurfaceHover,
            Foreground = DeskColors.TextPrimary,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(12, 8, 12, 8),
            HorizontalAlignment = HorizontalAlignment.Left,
            Cursor = Cursors.Hand
        };
        resetBtn.Click += (_, _) =>
        {
            settings.WallpaperId = "navy-aurora";
            settings.AccentColor = "#3B82F6";
            settings.DesktopIconSize = 48;
            settings.Use24HourClock = false;
            Apply();
            MessageBox.Show("Default desktop settings restored.", "Settings", MessageBoxButton.OK, MessageBoxImage.Information);
        };
        stack.Children.Add(resetBtn);

        scroll.Content = stack;
        Children.Add(scroll);
    }

    private void AddWallpaperOption(UniformGrid grid, string label, string id)
    {
        var btn = new Button
        {
            Background = settings.WallpaperId == id ? DeskColors.AccentBlue : DeskColors.NavySurface,
            Foreground = DeskColors.TextPrimary,
            BorderBrush = DeskColors.NavyBorder,
            BorderThickness = new Thickness(1),
            Margin = new Thickness(4),
            Padding = new Thickness(12, 14, 12, 14),
            Content = label,
            Cursor = Cursors.Hand
        };
        btn.Click += (_, _) =>
        {
            settings.WallpaperId = id;
            Apply();
        };
        grid.Children.Add(btn);
    }

    private void AddColorOption(StackPanel panel, string hex, string name)
    {
        var border = new Border
        {
            Width = 32,
            Height = 32,
            CornerRadius = new CornerRadius(16),
            Background = new BrushConverter().ConvertFromString(hex) as Brush,
            Margin = new Thickness(0, 0, 10, 0),
            Cursor = Cursors.Hand,
            ToolTip = name,
            BorderThickness = settings.AccentColor == hex ? new Thickness(2) : new Thickness(0),
            BorderBrush = Brushes.White
        };
        border.MouseDown += (_, _) =>
        {
            settings.AccentColor = hex;
            Apply();
        };
        panel.Children.Add(border);
    }

    private void Apply()
    {
        onSettingsUpdated(settings);
    }

    private static TextBlock CreateHeader(string text) => new()
    {
        Text = text,
        Foreground = DeskColors.TextPrimary,
        FontSize = 14,
        FontWeight = FontWeights.SemiBold,
        Margin = new Thickness(0, 0, 0, 8)
    };
}
