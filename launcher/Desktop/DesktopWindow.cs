using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using System.Windows.Threading;

namespace SurgePortable.Desktop;

/// <summary>
/// The primary WPF desktop window for Surge Portable.
/// Hosts the desktop workspace canvas, draggable shortcuts, internal window manager,
/// taskbar, start menu, calendar, and system tray.
/// </summary>
internal sealed class DesktopWindow : Window
{
    private readonly PathManager paths;
    private readonly LocalHelper helper;
    private readonly DesktopSettings settings;

    private readonly Grid rootGrid;
    private readonly Canvas desktopCanvas;
    private readonly Border taskbar;
    private readonly StackPanel taskbarRunningApps;
    private readonly TextBlock clockTimeBlock;
    private readonly TextBlock clockDateBlock;
    private readonly System.Windows.Shapes.Path vpnTrayIcon;
    private readonly TextBlock notifBadge;

    private readonly StartMenuFlyout startMenu;
    private readonly CalendarFlyout calendarFlyout;
    private readonly NotificationFlyout notificationFlyout;
    private readonly LockScreenControl lockScreen;

    private readonly List<DesktopAppWindow> openWindows = [];
    private readonly Dictionary<string, DesktopAppWindow> appWindowMap = [];
    private readonly DispatcherTimer clockTimer;

    private int activeZIndex = 10;
    private double nextWindowOffset = 40;

    public DesktopWindow(PathManager paths, LocalHelper helper)
    {
        this.paths = paths;
        this.helper = helper;

        // Load persisted desktop settings from USB
        settings = DesktopSettings.Load(paths);

        Title = "Surge Portable — Desktop Environment";
        Width = 1280;
        Height = 800;
        MinWidth = 800;
        MinHeight = 560;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        WindowState = WindowState.Maximized;
        Background = DeskColors.NavyDark;

        // Try setting application icon
        try
        {
            var iconUri = new Uri("pack://application:,,,/desktop/assets/icon.ico", UriKind.RelativeOrAbsolute);
            Icon = BitmapFrame.Create(iconUri);
        }
        catch { }

        rootGrid = new Grid();
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // Desktop
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(46) }); // Taskbar

        // --- 1. DESKTOP WORKSPACE CANVAS ---
        desktopCanvas = new Canvas
        {
            Background = GetWallpaperBrush(settings.WallpaperId),
            ClipToBounds = true
        };
        Grid.SetRow(desktopCanvas, 0);

        // Watermark in bottom-right corner of workspace
        var watermark = new StackPanel
        {
            Opacity = 0.22,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Bottom,
            Margin = new Thickness(0, 0, 24, 24),
            IsHitTestVisible = false
        };
        var wmLogo = new System.Windows.Shapes.Path
        {
            Data = AppIcons.SurgeLogo,
            Fill = DeskColors.AccentBlue,
            Width = 90,
            Height = 90,
            Stretch = Stretch.Uniform,
            HorizontalAlignment = HorizontalAlignment.Right
        };
        watermark.Children.Add(wmLogo);
        var wmLbl = new TextBlock
        {
            Text = "SURGE PORTABLE",
            Foreground = DeskColors.TextPrimary,
            FontSize = 18,
            FontWeight = FontWeights.Bold,
            HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(0, 4, 0, 0)
        };
        watermark.Children.Add(wmLbl);

        // Add Watermark behind windows
        var bgGrid = new Grid();
        bgGrid.Children.Add(watermark);
        bgGrid.Children.Add(desktopCanvas);
        Grid.SetRow(bgGrid, 0);
        rootGrid.Children.Add(bgGrid);

        // --- 2. DESKTOP SHORTCUTS ---
        PopulateDesktopShortcuts();

        // Canvas click closes flyouts
        desktopCanvas.MouseDown += (_, e) =>
        {
            if (e.OriginalSource == desktopCanvas)
            {
                CloseAllFlyouts();
            }
        };

        // --- 3. BOTTOM TASKBAR ---
        taskbar = new Border
        {
            Background = DeskColors.NavySurface,
            BorderBrush = DeskColors.NavyBorder,
            BorderThickness = new Thickness(0, 1, 0, 0),
            Height = 46
        };
        Grid.SetRow(taskbar, 1);

        var taskbarGrid = new Grid();
        taskbarGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Start & Pinned
        taskbarGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); // Running Apps
        taskbarGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Tray & Clock

        // Left Section: Start Button & Pinned Shortcuts
        var leftBar = new StackPanel { Orientation = Orientation.Horizontal };

        // Start Button
        var startBtn = new Border
        {
            Width = 44,
            Height = 38,
            Background = DeskColors.NavyCard,
            CornerRadius = new CornerRadius(6),
            Margin = new Thickness(6, 4, 8, 4),
            Cursor = Cursors.Hand,
            ToolTip = "Start (Surge Menu)"
        };
        var startIcon = new System.Windows.Shapes.Path
        {
            Data = AppIcons.Start,
            Fill = DeskColors.AccentBlue,
            Width = 20,
            Height = 20,
            Stretch = Stretch.Uniform,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        };
        startBtn.Child = startIcon;
        startBtn.MouseEnter += (_, _) => { startBtn.Background = DeskColors.NavySurfaceHover; startIcon.Fill = DeskColors.CyanGlow; };
        startBtn.MouseLeave += (_, _) => { startBtn.Background = DeskColors.NavyCard; startIcon.Fill = DeskColors.AccentBlue; };
        startBtn.MouseDown += (_, _) => ToggleFlyout(startMenu);
        leftBar.Children.Add(startBtn);

        // Pinned app quick launch buttons
        AddPinnedTaskbarIcon(leftBar, "browser", AppIcons.Browser, DeskColors.AccentBlue, "Surge Browser");
        AddPinnedTaskbarIcon(leftBar, "files", AppIcons.Files, DeskColors.AmberWarning, "My Files");
        AddPinnedTaskbarIcon(leftBar, "notes", AppIcons.Notes, DeskColors.EmeraldSuccess, "Notes");
        AddPinnedTaskbarIcon(leftBar, "vault", AppIcons.Vault, DeskColors.CyanGlow, "Passwords");
        AddPinnedTaskbarIcon(leftBar, "vpn", AppIcons.Vpn, DeskColors.AccentBlue, "VPN & Proxy");

        Grid.SetColumn(leftBar, 0);
        taskbarGrid.Children.Add(leftBar);

        // Center Section: Running Application Tabs
        taskbarRunningApps = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Margin = new Thickness(10, 0, 10, 0)
        };
        var scrollViewer = new ScrollViewer
        {
            HorizontalScrollBarVisibility = ScrollBarVisibility.Hidden,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Content = taskbarRunningApps
        };
        Grid.SetColumn(scrollViewer, 1);
        taskbarGrid.Children.Add(scrollViewer);

        // Right Section: System Tray & Clock
        var trayStack = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Margin = new Thickness(0, 0, 8, 0),
            VerticalAlignment = VerticalAlignment.Center
        };

        // Network icon
        trayStack.Children.Add(CreateTrayIcon(AppIcons.Wifi, DeskColors.TextMuted, "Network: Connected"));

        // Volume icon
        trayStack.Children.Add(CreateTrayIcon(AppIcons.Volume, DeskColors.TextMuted, "Audio: Active"));

        // Battery icon
        trayStack.Children.Add(CreateTrayIcon(AppIcons.Battery, DeskColors.TextMuted, "Battery / Power status"));

        // USB Indicator icon
        var usbDrive = Path.GetPathRoot(paths.Root) ?? "USB";
        trayStack.Children.Add(CreateTrayIcon(AppIcons.Usb, DeskColors.CyanGlow, $"Surge Portable USB ({usbDrive})"));

        // VPN icon
        vpnTrayIcon = new System.Windows.Shapes.Path
        {
            Data = AppIcons.Vpn,
            Fill = helper.Policy.ProtectionActive ? DeskColors.CyanGlow : DeskColors.TextMuted,
            Width = 15,
            Height = 15,
            Stretch = Stretch.Uniform,
            Margin = new Thickness(5, 0, 5, 0),
            Cursor = Cursors.Hand,
            ToolTip = helper.Policy.ProtectionActive ? "VPN Active" : "VPN Disconnected"
        };
        vpnTrayIcon.MouseDown += (_, _) => LaunchOrActivateApp("vpn");
        trayStack.Children.Add(vpnTrayIcon);

        // Notification Bell with badge
        var notifBtn = new Grid
        {
            Width = 28,
            Height = 36,
            Cursor = Cursors.Hand,
            Margin = new Thickness(4, 0, 4, 0),
            ToolTip = "Notifications & Quick Settings"
        };
        var bell = new System.Windows.Shapes.Path
        {
            Data = AppIcons.Bell,
            Fill = DeskColors.TextMuted,
            Width = 15,
            Height = 15,
            Stretch = Stretch.Uniform,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        };
        notifBtn.Children.Add(bell);
        notifBadge = new TextBlock
        {
            Text = "2",
            Foreground = Brushes.White,
            Background = DeskColors.AccentBlue,
            FontSize = 9,
            FontWeight = FontWeights.Bold,
            Padding = new Thickness(3, 1, 3, 1),
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 4, 0, 0)
        };
        notifBtn.Children.Add(notifBadge);
        notifBtn.MouseDown += (_, _) => ToggleFlyout(notificationFlyout);
        trayStack.Children.Add(notifBtn);

        // Live Clock & Date Box
        var clockBorder = new Border
        {
            Background = Brushes.Transparent,
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(8, 2, 8, 2),
            Margin = new Thickness(4, 0, 0, 0),
            Cursor = Cursors.Hand,
            ToolTip = "View Calendar and Real-Time Clock"
        };
        var clockStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        clockTimeBlock = new TextBlock
        {
            Foreground = DeskColors.TextPrimary,
            FontSize = 11.5,
            FontWeight = FontWeights.SemiBold,
            TextAlignment = TextAlignment.Right
        };
        clockStack.Children.Add(clockTimeBlock);

        clockDateBlock = new TextBlock
        {
            Foreground = DeskColors.TextMuted,
            FontSize = 10,
            TextAlignment = TextAlignment.Right
        };
        clockStack.Children.Add(clockDateBlock);
        clockBorder.Child = clockStack;

        clockBorder.MouseEnter += (_, _) => clockBorder.Background = DeskColors.NavySurfaceHover;
        clockBorder.MouseLeave += (_, _) => clockBorder.Background = Brushes.Transparent;
        clockBorder.MouseDown += (_, _) => ToggleFlyout(calendarFlyout);
        trayStack.Children.Add(clockBorder);

        Grid.SetColumn(trayStack, 2);
        taskbarGrid.Children.Add(trayStack);

        taskbar.Child = taskbarGrid;
        rootGrid.Children.Add(taskbar);

        // --- 4. FLYOUTS LAYER (Floated above Desktop) ---
        startMenu = new StartMenuFlyout(paths, appId => LaunchOrActivateApp(appId), LockSession, Close)
        {
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Bottom,
            Margin = new Thickness(8, 0, 0, 52),
            Visibility = Visibility.Collapsed
        };
        Grid.SetRowSpan(startMenu, 2);
        Panel.SetZIndex(startMenu, 9999);
        rootGrid.Children.Add(startMenu);

        calendarFlyout = new CalendarFlyout(settings)
        {
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Bottom,
            Margin = new Thickness(0, 0, 8, 52),
            Visibility = Visibility.Collapsed
        };
        Grid.SetRowSpan(calendarFlyout, 2);
        Panel.SetZIndex(calendarFlyout, 9999);
        rootGrid.Children.Add(calendarFlyout);

        notificationFlyout = new NotificationFlyout(() => LaunchOrActivateApp("settings"), () => { if (appWindowMap.TryGetValue("vault", out var vw) && vw.Child is VaultAppView vApp) vApp.Lock(); })
        {
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Bottom,
            Margin = new Thickness(0, 0, 48, 52),
            Visibility = Visibility.Collapsed
        };
        Grid.SetRowSpan(notificationFlyout, 2);
        Panel.SetZIndex(notificationFlyout, 9999);
        rootGrid.Children.Add(notificationFlyout);

        // --- 5. FULLSCREEN LOCK SCREEN OVERLAY ---
        lockScreen = new LockScreenControl(paths, () => { })
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch
        };
        Grid.SetRowSpan(lockScreen, 2);
        Panel.SetZIndex(lockScreen, 100000);
        rootGrid.Children.Add(lockScreen);

        Content = rootGrid;

        // Size changed updates maximized windows
        desktopCanvas.SizeChanged += (_, _) =>
        {
            foreach (var win in openWindows)
            {
                if (win.IsMaximized)
                    win.UpdateMaximizedSize(desktopCanvas.ActualWidth, desktopCanvas.ActualHeight);
            }
        };

        // Real-time live clock timer (1s interval)
        clockTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        clockTimer.Tick += (_, _) => UpdateClock();
        clockTimer.Start();
        UpdateClock();

        // Launch Browser on startup by default
        Loaded += (_, _) =>
        {
            LaunchOrActivateApp("browser");
        };
    }

    private void UpdateClock()
    {
        var now = DateTime.Now;
        clockTimeBlock.Text = settings.Use24HourClock ? now.ToString("HH:mm") : now.ToString("h:mm tt");
        clockDateBlock.Text = now.ToString("dd/MM/yyyy");
    }

    private void LockSession()
    {
        CloseAllFlyouts();
        lockScreen.Show();
    }

    private void ToggleFlyout(FrameworkElement flyout)
    {
        bool wasVisible = flyout.Visibility == Visibility.Visible;
        CloseAllFlyouts();
        if (!wasVisible)
            flyout.Visibility = Visibility.Visible;
    }

    private void CloseAllFlyouts()
    {
        startMenu.Visibility = Visibility.Collapsed;
        calendarFlyout.Visibility = Visibility.Collapsed;
        notificationFlyout.Visibility = Visibility.Collapsed;
    }

    // ========================================================================
    // WINDOW MANAGER
    // ========================================================================
    public void LaunchOrActivateApp(string appId, string? param = null)
    {
        CloseAllFlyouts();

        if (appWindowMap.TryGetValue(appId, out var existing))
        {
            existing.Activate();
            BringToFront(existing);
            return;
        }

        // Instantiate new window
        (string title, Geometry icon, Brush brush, UIElement content, double initW, double initH) = CreateAppContent(appId, param);

        var appWindow = new DesktopAppWindow(appId, title, icon, brush, content)
        {
            Width = Math.Min(initW, Math.Max(400, desktopCanvas.ActualWidth - 60)),
            Height = Math.Min(initH, Math.Max(300, desktopCanvas.ActualHeight - 60))
        };

        // Stagger window position
        double posX = nextWindowOffset;
        double posY = nextWindowOffset;
        nextWindowOffset = (nextWindowOffset + 32) % 240 + 20;

        Canvas.SetLeft(appWindow, posX);
        Canvas.SetTop(appWindow, posY);

        appWindow.Activated += Win_Activated;
        appWindow.Closed += Win_Closed;
        appWindow.MinimizedStateChanged += Win_MinimizedStateChanged;

        desktopCanvas.Children.Add(appWindow);
        openWindows.Add(appWindow);
        appWindowMap[appId] = appWindow;

        AddTaskbarTab(appWindow, icon, brush);
        BringToFront(appWindow);
    }

    private (string Title, Geometry Icon, Brush Brush, UIElement Content, double W, double H) CreateAppContent(string appId, string? param)
    {
        return appId switch
        {
            "browser" => ("Surge Browser", AppIcons.Browser, DeskColors.AccentBlue, new BrowserAppView(paths, helper, param), 980, 640),
            "files" => ("My Files — USB Workspace", AppIcons.Files, DeskColors.AmberWarning, new FilesAppView(paths), 820, 520),
            "notes" => ("Notes", AppIcons.Notes, DeskColors.EmeraldSuccess, new NotesAppView(paths), 860, 560),
            "vault" => ("Password Vault", AppIcons.Vault, DeskColors.CyanGlow, new VaultAppView(paths), 740, 500),
            "vpn" => ("VPN & Proxy Protection", AppIcons.Vpn, DeskColors.AccentBlue, new VpnAppView(paths, helper), 620, 560),
            "downloads" => ("Downloads", AppIcons.Downloads, DeskColors.CyanGlow, new DownloadsAppView(paths), 680, 480),
            "settings" => ("Settings", AppIcons.Settings, DeskColors.TextPrimary, new SettingsAppView(settings, OnSettingsChanged), 640, 580),
            _ => ("Application", AppIcons.SurgeLogo, DeskColors.AccentBlue, new TextBlock { Text = "App: " + appId }, 600, 400)
        };
    }

    private void Win_Activated(DesktopAppWindow win)
    {
        BringToFront(win);
    }

    private void Win_Closed(DesktopAppWindow win)
    {
        desktopCanvas.Children.Remove(win);
        openWindows.Remove(win);
        appWindowMap.Remove(win.AppId);
        RemoveTaskbarTab(win);
    }

    private void Win_MinimizedStateChanged(DesktopAppWindow win)
    {
        UpdateTaskbarTabVisuals();
    }

    private void BringToFront(DesktopAppWindow win)
    {
        Panel.SetZIndex(win, ++activeZIndex);
        foreach (var w in openWindows)
            w.SetActive(w == win);
        UpdateTaskbarTabVisuals();
    }

    // ========================================================================
    // TASKBAR TABS
    // ========================================================================
    private readonly Dictionary<DesktopAppWindow, Border> tabMap = [];

    private void AddTaskbarTab(DesktopAppWindow win, Geometry icon, Brush brush)
    {
        var tab = new Border
        {
            Background = DeskColors.NavyCard,
            BorderThickness = new Thickness(0, 0, 0, 2),
            BorderBrush = DeskColors.AccentBlue,
            CornerRadius = new CornerRadius(4, 4, 0, 0),
            Margin = new Thickness(3, 4, 3, 0),
            Padding = new Thickness(10, 4, 10, 4),
            Cursor = Cursors.Hand,
            ToolTip = win.Title,
            MaxWidth = 180
        };

        var stack = new StackPanel { Orientation = Orientation.Horizontal };
        var iconP = new System.Windows.Shapes.Path
        {
            Data = icon,
            Fill = brush,
            Width = 14,
            Height = 14,
            Stretch = Stretch.Uniform,
            Margin = new Thickness(0, 0, 6, 0)
        };
        stack.Children.Add(iconP);

        var txt = new TextBlock
        {
            Text = win.Title,
            Foreground = DeskColors.TextPrimary,
            FontSize = 11.5,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis
        };
        stack.Children.Add(txt);
        tab.Child = stack;

        tab.MouseDown += (_, _) =>
        {
            if (win.IsMinimized)
            {
                win.RestoreFromMinimized();
                BringToFront(win);
            }
            else if (win.IsActive)
            {
                win.ToggleMinimize();
            }
            else
            {
                win.Activate();
                BringToFront(win);
            }
        };

        tabMap[win] = tab;
        taskbarRunningApps.Children.Add(tab);
    }

    private void RemoveTaskbarTab(DesktopAppWindow win)
    {
        if (tabMap.TryGetValue(win, out var tab))
        {
            taskbarRunningApps.Children.Remove(tab);
            tabMap.Remove(win);
        }
    }

    private void UpdateTaskbarTabVisuals()
    {
        foreach (var (win, tab) in tabMap)
        {
            if (win.IsActive && !win.IsMinimized)
            {
                tab.Background = DeskColors.NavySurfaceHover;
                tab.BorderBrush = DeskColors.CyanGlow;
            }
            else if (win.IsMinimized)
            {
                tab.Background = DeskColors.NavyDark;
                tab.BorderBrush = DeskColors.NavyBorder;
            }
            else
            {
                tab.Background = DeskColors.NavyCard;
                tab.BorderBrush = DeskColors.AccentBlue;
            }
        }
    }

    // ========================================================================
    // DESKTOP SHORTCUTS
    // ========================================================================
    private void PopulateDesktopShortcuts()
    {
        double startX = 24;
        double startY = 24;
        double colWidth = 90;
        double rowHeight = 90;
        int row = 0;
        int col = 0;

        foreach (var sc in settings.Shortcuts)
        {
            var iconGeom = sc.Id switch
            {
                "browser" => AppIcons.Browser,
                "files" => AppIcons.Files,
                "notes" => AppIcons.Notes,
                "vault" => AppIcons.Vault,
                "vpn" => AppIcons.Vpn,
                "downloads" => AppIcons.Downloads,
                "settings" => AppIcons.Settings,
                _ => AppIcons.SurgeLogo
            };

            var iconBrush = sc.Id switch
            {
                "browser" => DeskColors.AccentBlue,
                "files" => DeskColors.AmberWarning,
                "notes" => DeskColors.EmeraldSuccess,
                "vault" => DeskColors.CyanGlow,
                "vpn" => DeskColors.AccentBlue,
                "downloads" => DeskColors.CyanGlow,
                "settings" => DeskColors.TextPrimary,
                _ => DeskColors.AccentBlue
            };

            var shortcutControl = CreateShortcutItem(sc, iconGeom, iconBrush);

            double left = sc.PositionX >= 0 ? sc.PositionX : startX + (col * colWidth);
            double top = sc.PositionY >= 0 ? sc.PositionY : startY + (row * rowHeight);

            Canvas.SetLeft(shortcutControl, left);
            Canvas.SetTop(shortcutControl, top);

            desktopCanvas.Children.Add(shortcutControl);

            row++;
            if (row > 6)
            {
                row = 0;
                col++;
            }
        }
    }

    private Border CreateShortcutItem(DesktopShortcut sc, Geometry icon, Brush brush)
    {
        double iconSize = settings.DesktopIconSize switch
        {
            36 => 28,
            64 => 44,
            _ => 36
        };

        var border = new Border
        {
            Width = 84,
            Height = 84,
            Background = Brushes.Transparent,
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(6),
            Cursor = Cursors.Hand
        };

        var stack = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        var iconP = new System.Windows.Shapes.Path
        {
            Data = icon,
            Fill = brush,
            Width = iconSize,
            Height = iconSize,
            Stretch = Stretch.Uniform,
            Margin = new Thickness(0, 0, 0, 6)
        };
        stack.Children.Add(iconP);

        var txt = new TextBlock
        {
            Text = sc.Title,
            Foreground = DeskColors.TextPrimary,
            FontSize = 11.5,
            FontWeight = FontWeights.Medium,
            TextAlignment = TextAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis
        };
        stack.Children.Add(txt);

        border.Child = stack;

        border.MouseEnter += (_, _) => border.Background = DeskColors.NavySurfaceHover;
        border.MouseLeave += (_, _) => border.Background = Brushes.Transparent;

        // Double click launches app
        border.MouseLeftButtonDown += (_, e) =>
        {
            if (e.ClickCount == 2)
                LaunchOrActivateApp(sc.Id);
        };

        return border;
    }

    private void AddPinnedTaskbarIcon(StackPanel panel, string appId, Geometry icon, Brush brush, string tooltip)
    {
        var btn = new Border
        {
            Width = 38,
            Height = 36,
            Background = Brushes.Transparent,
            CornerRadius = new CornerRadius(4),
            Margin = new Thickness(2, 4, 2, 4),
            Cursor = Cursors.Hand,
            ToolTip = tooltip
        };
        var iconP = new System.Windows.Shapes.Path
        {
            Data = icon,
            Fill = brush,
            Width = 16,
            Height = 16,
            Stretch = Stretch.Uniform,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        };
        btn.Child = iconP;
        btn.MouseEnter += (_, _) => btn.Background = DeskColors.NavySurfaceHover;
        btn.MouseLeave += (_, _) => btn.Background = Brushes.Transparent;
        btn.MouseDown += (_, _) => LaunchOrActivateApp(appId);
        panel.Children.Add(btn);
    }

    private static FrameworkElement CreateTrayIcon(Geometry icon, Brush brush, string tooltip)
    {
        var path = new System.Windows.Shapes.Path
        {
            Data = icon,
            Fill = brush,
            Width = 15,
            Height = 15,
            Stretch = Stretch.Uniform,
            Margin = new Thickness(5, 0, 5, 0),
            Cursor = Cursors.Arrow,
            ToolTip = tooltip
        };
        return path;
    }

    private void OnSettingsChanged(DesktopSettings updated)
    {
        desktopCanvas.Background = GetWallpaperBrush(updated.WallpaperId);
        updated.Save(paths);
        UpdateClock();
    }

    private static Brush GetWallpaperBrush(string wallpaperId)
    {
        return wallpaperId switch
        {
            "pure-dark" => new SolidColorBrush(Color.FromRgb(5, 7, 12)),
            "surge-cyber" => new LinearGradientBrush(
                Color.FromRgb(6, 12, 28),
                Color.FromRgb(10, 24, 48),
                new Point(0, 0),
                new Point(1, 1)),
            _ => new LinearGradientBrush(
                Color.FromRgb(10, 16, 26),
                Color.FromRgb(15, 23, 42),
                new Point(0.5, 0),
                new Point(0.5, 1))
        };
    }
}
