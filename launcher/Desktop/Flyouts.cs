using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Shapes;
using System.Windows.Threading;

namespace SurgePortable.Desktop;

// ============================================================================
// 1. START MENU FLYOUT
// ============================================================================
public sealed class StartMenuFlyout : Border
{
    private readonly Action<string> onLaunchApp;
    private readonly Action onLockSession;
    private readonly Action onExit;
    private readonly TextBox searchBox;
    private readonly WrapPanel pinnedPanel;
    private readonly List<AppEntry> allApps = [];

    public StartMenuFlyout(PathManager paths, Action<string> onLaunchApp, Action onLockSession, Action onExit)
    {
        this.onLaunchApp = onLaunchApp;
        this.onLockSession = onLockSession;
        this.onExit = onExit;

        Width = 440;
        Height = 520;
        Background = DeskColors.NavySurface;
        BorderBrush = DeskColors.NavyBorder;
        BorderThickness = new Thickness(1);
        CornerRadius = new CornerRadius(10);
        Padding = new Thickness(16);

        Effect = new DropShadowEffect
        {
            BlurRadius = 32,
            ShadowDepth = 10,
            Direction = 270,
            Opacity = 0.65,
            Color = Colors.Black
        };

        var rootGrid = new Grid();
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // Search
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // Pinned Apps
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // User bar

        // --- SEARCH BAR ---
        var searchBorder = new Border
        {
            Background = DeskColors.NavyDark,
            BorderBrush = DeskColors.NavyBorder,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(10, 8, 10, 8),
            Margin = new Thickness(0, 0, 0, 16)
        };
        var searchGrid = new Grid();
        searchGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        searchGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var searchIcon = new System.Windows.Shapes.Path
        {
            Data = AppIcons.Search,
            Fill = DeskColors.TextMuted,
            Width = 14,
            Height = 14,
            Stretch = Stretch.Uniform,
            Margin = new Thickness(0, 0, 8, 0)
        };
        Grid.SetColumn(searchIcon, 0);
        searchGrid.Children.Add(searchIcon);

        searchBox = new TextBox
        {
            Background = Brushes.Transparent,
            Foreground = DeskColors.TextPrimary,
            BorderThickness = new Thickness(0),
            FontSize = 13,
            CaretBrush = DeskColors.CyanGlow
        };
        searchBox.TextChanged += (_, _) => FilterApps(searchBox.Text);
        Grid.SetColumn(searchBox, 1);
        searchGrid.Children.Add(searchBox);

        searchBorder.Child = searchGrid;
        Grid.SetRow(searchBorder, 0);
        rootGrid.Children.Add(searchBorder);

        // --- PINNED APPS AREA ---
        var pinnedScroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        var pinnedStack = new StackPanel();

        var pinnedHeader = new TextBlock
        {
            Text = "Pinned Applications",
            Foreground = DeskColors.TextMuted,
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            Margin = new Thickness(4, 0, 0, 10)
        };
        pinnedStack.Children.Add(pinnedHeader);

        pinnedPanel = new WrapPanel { Margin = new Thickness(0, 0, 0, 10) };
        pinnedStack.Children.Add(pinnedPanel);

        pinnedScroll.Content = pinnedStack;
        Grid.SetRow(pinnedScroll, 1);
        rootGrid.Children.Add(pinnedScroll);

        // Initialize Apps list
        allApps.Add(new AppEntry("browser", "Surge Browser", AppIcons.Browser, DeskColors.AccentBlue, "Secure portable browsing"));
        allApps.Add(new AppEntry("files", "My Files", AppIcons.Files, DeskColors.AmberWarning, "USB workspace storage"));
        allApps.Add(new AppEntry("notes", "Notes", AppIcons.Notes, DeskColors.EmeraldSuccess, "Encrypted markdown notes"));
        allApps.Add(new AppEntry("vault", "Passwords", AppIcons.Vault, DeskColors.CyanGlow, "Windows Hello biometric vault"));
        allApps.Add(new AppEntry("vpn", "VPN & Proxy", AppIcons.Vpn, DeskColors.AccentBlue, "SOCKS5 and HTTPS tunneling"));
        allApps.Add(new AppEntry("downloads", "Downloads", AppIcons.Downloads, DeskColors.CyanGlow, "Downloaded workspace files"));
        allApps.Add(new AppEntry("settings", "Settings", AppIcons.Settings, DeskColors.TextPrimary, "Personalize desktop"));

        PopulateAppButtons(allApps);

        // --- BOTTOM USER PROFILE BAR ---
        var userBar = new Border
        {
            Background = DeskColors.NavyCard,
            BorderBrush = DeskColors.NavyBorder,
            BorderThickness = new Thickness(0, 1, 0, 0),
            Padding = new Thickness(8, 10, 8, 4),
            Margin = new Thickness(0, 8, 0, 0)
        };
        Grid.SetRow(userBar, 2);

        var userGrid = new Grid();
        userGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Avatar
        userGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); // Name & USB
        userGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Lock
        userGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Power

        var avatar = new Border
        {
            Width = 32,
            Height = 32,
            CornerRadius = new CornerRadius(16),
            Background = DeskColors.AccentBlue,
            Margin = new Thickness(0, 0, 10, 0)
        };
        var avatarIcon = new System.Windows.Shapes.Path
        {
            Data = AppIcons.SurgeLogo,
            Fill = Brushes.White,
            Width = 16,
            Height = 16,
            Stretch = Stretch.Uniform
        };
        avatar.Child = avatarIcon;
        Grid.SetColumn(avatar, 0);
        userGrid.Children.Add(avatar);

        var userTextStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        userTextStack.Children.Add(new TextBlock { Text = "Surge Workspace", Foreground = DeskColors.TextPrimary, FontSize = 12.5, FontWeight = FontWeights.SemiBold });
        userTextStack.Children.Add(new TextBlock { Text = paths.Root, Foreground = DeskColors.TextMuted, FontSize = 11, TextTrimming = TextTrimming.CharacterEllipsis });
        Grid.SetColumn(userTextStack, 1);
        userGrid.Children.Add(userTextStack);

        var lockBtn = CreateFlyoutIconButton(AppIcons.Lock, "Lock Surge Workspace", () => onLockSession());
        Grid.SetColumn(lockBtn, 2);
        userGrid.Children.Add(lockBtn);

        var exitBtn = CreateFlyoutIconButton(AppIcons.Power, "Exit Surge Portable", () => onExit());
        Grid.SetColumn(exitBtn, 3);
        userGrid.Children.Add(exitBtn);

        userBar.Child = userGrid;
        rootGrid.Children.Add(userBar);

        Child = rootGrid;
    }

    private void PopulateAppButtons(IEnumerable<AppEntry> apps)
    {
        pinnedPanel.Children.Clear();
        foreach (var app in apps)
        {
            var btn = new Border
            {
                Width = 96,
                Height = 84,
                Background = Brushes.Transparent,
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(6),
                Margin = new Thickness(2),
                Cursor = Cursors.Hand
            };

            var stack = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            var icon = new System.Windows.Shapes.Path
            {
                Data = app.Icon,
                Fill = app.IconBrush,
                Width = 28,
                Height = 28,
                Stretch = Stretch.Uniform,
                Margin = new Thickness(0, 0, 0, 6)
            };
            stack.Children.Add(icon);

            var nameBlock = new TextBlock
            {
                Text = app.Title,
                Foreground = DeskColors.TextPrimary,
                FontSize = 11.5,
                TextAlignment = TextAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis
            };
            stack.Children.Add(nameBlock);

            btn.Child = stack;

            btn.MouseEnter += (_, _) => btn.Background = DeskColors.NavySurfaceHover;
            btn.MouseLeave += (_, _) => btn.Background = Brushes.Transparent;
            btn.MouseDown += (_, _) =>
            {
                onLaunchApp(app.Id);
                Visibility = Visibility.Collapsed;
            };

            pinnedPanel.Children.Add(btn);
        }
    }

    private void FilterApps(string query)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            PopulateAppButtons(allApps);
            return;
        }

        var matches = allApps.Where(a => a.Title.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                                         a.Description.Contains(query, StringComparison.OrdinalIgnoreCase));
        PopulateAppButtons(matches);
    }

    private static Button CreateFlyoutIconButton(Geometry icon, string tooltip, Action onClick)
    {
        var path = new System.Windows.Shapes.Path
        {
            Data = icon,
            Fill = DeskColors.TextMuted,
            Width = 16,
            Height = 16,
            Stretch = Stretch.Uniform
        };
        var btn = new Button
        {
            Content = path,
            Width = 34,
            Height = 34,
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            Cursor = Cursors.Hand,
            ToolTip = tooltip,
            Margin = new Thickness(2, 0, 2, 0)
        };
        btn.MouseEnter += (_, _) => path.Fill = DeskColors.TextPrimary;
        btn.MouseLeave += (_, _) => path.Fill = DeskColors.TextMuted;
        btn.Click += (_, _) => onClick();
        return btn;
    }

    public sealed record AppEntry(string Id, string Title, Geometry Icon, Brush IconBrush, string Description);
}

// ============================================================================
// 2. CALENDAR FLYOUT (Live Clock & Calendar)
// ============================================================================
public sealed class CalendarFlyout : Border
{
    private readonly DesktopSettings settings;
    private readonly TextBlock digitalClockBlock;
    private readonly TextBlock dateLongBlock;
    private readonly TextBlock monthYearBlock;
    private readonly UniformGrid calendarGrid;
    private DateTime viewingMonth;
    private readonly DispatcherTimer clockTimer;

    public CalendarFlyout(DesktopSettings settings)
    {
        this.settings = settings;
        viewingMonth = DateTime.Today;

        Width = 360;
        Height = 440;
        Background = DeskColors.NavySurface;
        BorderBrush = DeskColors.NavyBorder;
        BorderThickness = new Thickness(1);
        CornerRadius = new CornerRadius(10);
        Padding = new Thickness(18);

        Effect = new DropShadowEffect
        {
            BlurRadius = 32,
            ShadowDepth = 10,
            Direction = 270,
            Opacity = 0.65,
            Color = Colors.Black
        };

        var rootGrid = new Grid();
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // Live Clock & Date
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1) });  // Separator
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // Month Nav
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // Weekday labels
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // Days Grid
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // Today button

        // 1. Digital Clock & Date
        var timeStack = new StackPanel { Margin = new Thickness(0, 0, 0, 14) };
        digitalClockBlock = new TextBlock
        {
            Foreground = DeskColors.TextPrimary,
            FontSize = 32,
            FontWeight = FontWeights.Light,
            FontFamily = new FontFamily("Segoe UI Variable Display, Segoe UI")
        };
        timeStack.Children.Add(digitalClockBlock);

        dateLongBlock = new TextBlock
        {
            Foreground = DeskColors.CyanGlow,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Margin = new Thickness(2, 2, 0, 0)
        };
        timeStack.Children.Add(dateLongBlock);

        Grid.SetRow(timeStack, 0);
        rootGrid.Children.Add(timeStack);

        // Separator
        var sep = new Rectangle { Fill = DeskColors.NavyBorder, Height = 1, Margin = new Thickness(0, 0, 0, 12) };
        Grid.SetRow(sep, 1);
        rootGrid.Children.Add(sep);

        // 2. Month Navigation
        var navGrid = new Grid { Margin = new Thickness(0, 0, 0, 10) };
        navGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        navGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        navGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        monthYearBlock = new TextBlock
        {
            Foreground = DeskColors.TextPrimary,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            VerticalAlignment = VerticalAlignment.Center
        };
        Grid.SetColumn(monthYearBlock, 0);
        navGrid.Children.Add(monthYearBlock);

        var prevBtn = CreateNavBtn("<", () =>
        {
            viewingMonth = viewingMonth.AddMonths(-1);
            RenderCalendar();
        });
        Grid.SetColumn(prevBtn, 1);
        navGrid.Children.Add(prevBtn);

        var nextBtn = CreateNavBtn(">", () =>
        {
            viewingMonth = viewingMonth.AddMonths(1);
            RenderCalendar();
        });
        Grid.SetColumn(nextBtn, 2);
        navGrid.Children.Add(nextBtn);

        Grid.SetRow(navGrid, 2);
        rootGrid.Children.Add(navGrid);

        // 3. Day of week labels
        var dowGrid = new UniformGrid { Columns = 7, Margin = new Thickness(0, 0, 0, 6) };
        string[] dows = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
        foreach (var day in dows)
        {
            dowGrid.Children.Add(new TextBlock
            {
                Text = day,
                Foreground = DeskColors.TextMuted,
                FontSize = 11,
                FontWeight = FontWeights.SemiBold,
                TextAlignment = TextAlignment.Center
            });
        }
        Grid.SetRow(dowGrid, 3);
        rootGrid.Children.Add(dowGrid);

        // 4. Days Grid
        calendarGrid = new UniformGrid { Columns = 7, Rows = 6 };
        Grid.SetRow(calendarGrid, 4);
        rootGrid.Children.Add(calendarGrid);

        // 5. Today button
        var todayBtn = new Button
        {
            Content = "Today",
            Background = Brushes.Transparent,
            Foreground = DeskColors.AccentBlue,
            BorderThickness = new Thickness(0),
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(0, 8, 0, 0),
            Cursor = Cursors.Hand
        };
        todayBtn.Click += (_, _) =>
        {
            viewingMonth = DateTime.Today;
            RenderCalendar();
        };
        Grid.SetRow(todayBtn, 5);
        rootGrid.Children.Add(todayBtn);

        Child = rootGrid;

        // Clock timer
        clockTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        clockTimer.Tick += (_, _) => UpdateTime();
        clockTimer.Start();
        UpdateTime();
        RenderCalendar();
    }

    private void UpdateTime()
    {
        var now = DateTime.Now;
        digitalClockBlock.Text = settings.Use24HourClock ? now.ToString("HH:mm:ss") : now.ToString("h:mm:ss tt");
        dateLongBlock.Text = now.ToString("dddd, MMMM d, yyyy");
    }

    private void RenderCalendar()
    {
        monthYearBlock.Text = viewingMonth.ToString("MMMM yyyy");
        calendarGrid.Children.Clear();

        var firstDayOfMonth = new DateTime(viewingMonth.Year, viewingMonth.Month, 1);
        int dayOfWeekOffset = (int)firstDayOfMonth.DayOfWeek;
        int daysInMonth = DateTime.DaysInMonth(viewingMonth.Year, viewingMonth.Month);

        // Prev month padding
        var prevMonth = viewingMonth.AddMonths(-1);
        int prevMonthDays = DateTime.DaysInMonth(prevMonth.Year, prevMonth.Month);
        for (int i = 0; i < dayOfWeekOffset; i++)
        {
            int d = prevMonthDays - dayOfWeekOffset + 1 + i;
            calendarGrid.Children.Add(CreateDayCell(d.ToString(), DeskColors.TextMuted, false));
        }

        // Current month days
        for (int day = 1; day <= daysInMonth; day++)
        {
            bool isToday = (day == DateTime.Today.Day && viewingMonth.Year == DateTime.Today.Year && viewingMonth.Month == DateTime.Today.Month);
            calendarGrid.Children.Add(CreateDayCell(day.ToString(), DeskColors.TextPrimary, isToday));
        }

        // Next month padding to fill 42 cells
        int cellsAdded = dayOfWeekOffset + daysInMonth;
        for (int i = 1; i <= 42 - cellsAdded; i++)
        {
            calendarGrid.Children.Add(CreateDayCell(i.ToString(), DeskColors.TextMuted, false));
        }
    }

    private static Border CreateDayCell(string text, Brush color, bool isToday)
    {
        var border = new Border
        {
            CornerRadius = new CornerRadius(14),
            Background = isToday ? DeskColors.AccentBlue : Brushes.Transparent,
            Width = 28,
            Height = 28,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(2)
        };
        var tb = new TextBlock
        {
            Text = text,
            Foreground = isToday ? Brushes.White : color,
            FontSize = 12,
            FontWeight = isToday ? FontWeights.Bold : FontWeights.Normal,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        };
        border.Child = tb;
        return border;
    }

    private static Button CreateNavBtn(string text, Action action)
    {
        var btn = new Button
        {
            Content = text,
            Width = 28,
            Height = 28,
            Background = DeskColors.NavySurfaceHover,
            Foreground = DeskColors.TextPrimary,
            BorderThickness = new Thickness(0),
            Cursor = Cursors.Hand,
            Margin = new Thickness(2, 0, 0, 0)
        };
        btn.Click += (_, _) => action();
        return btn;
    }
}

// ============================================================================
// 3. NOTIFICATION & QUICK SETTINGS FLYOUT
// ============================================================================
public sealed class NotificationFlyout : Border
{
    private readonly StackPanel notifList;
    private readonly TextBlock emptyNotice;

    public NotificationFlyout(Action onOpenSettings, Action onLockVault)
    {
        Width = 380;
        Height = 460;
        Background = DeskColors.NavySurface;
        BorderBrush = DeskColors.NavyBorder;
        BorderThickness = new Thickness(1);
        CornerRadius = new CornerRadius(10);
        Padding = new Thickness(16);

        Effect = new DropShadowEffect
        {
            BlurRadius = 32,
            ShadowDepth = 10,
            Direction = 270,
            Opacity = 0.65,
            Color = Colors.Black
        };

        var rootGrid = new Grid();
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // Quick settings tiles
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1) });  // Separator
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // Notification header
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // Notifications feed

        // --- QUICK SETTINGS TILES ---
        var tilesGrid = new UniformGrid { Columns = 3, Margin = new Thickness(0, 0, 0, 16) };
        tilesGrid.Children.Add(CreateQuickTile(AppIcons.Wifi, "Network", "Connected"));
        tilesGrid.Children.Add(CreateQuickTile(AppIcons.Vpn, "VPN", "Active"));
        tilesGrid.Children.Add(CreateQuickTile(AppIcons.Volume, "Sound", "100%"));
        tilesGrid.Children.Add(CreateQuickTile(AppIcons.Battery, "Battery", GetBatteryStatus()));
        tilesGrid.Children.Add(CreateQuickTile(AppIcons.Lock, "Lock Vault", "Tap to Lock", onLockVault));
        tilesGrid.Children.Add(CreateQuickTile(AppIcons.Settings, "Settings", "Configure", onOpenSettings));

        Grid.SetRow(tilesGrid, 0);
        rootGrid.Children.Add(tilesGrid);

        // Separator
        var sep = new Rectangle { Fill = DeskColors.NavyBorder, Height = 1, Margin = new Thickness(0, 0, 0, 12) };
        Grid.SetRow(sep, 1);
        rootGrid.Children.Add(sep);

        // Header
        var headerGrid = new Grid { Margin = new Thickness(0, 0, 0, 8) };
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var headerTitle = new TextBlock
        {
            Text = "Notifications",
            Foreground = DeskColors.TextPrimary,
            FontSize = 13,
            FontWeight = FontWeights.SemiBold
        };
        Grid.SetColumn(headerTitle, 0);
        headerGrid.Children.Add(headerTitle);

        var clearBtn = new Button
        {
            Content = "Clear all",
            Foreground = DeskColors.CyanGlow,
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            FontSize = 11.5,
            Cursor = Cursors.Hand
        };
        clearBtn.Click += (_, _) => ClearNotifications();
        Grid.SetColumn(clearBtn, 1);
        headerGrid.Children.Add(clearBtn);

        Grid.SetRow(headerGrid, 2);
        rootGrid.Children.Add(headerGrid);

        // Feed
        var scroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        notifList = new StackPanel();

        emptyNotice = new TextBlock
        {
            Text = "No new notifications",
            Foreground = DeskColors.TextMuted,
            FontSize = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 40, 0, 0)
        };
        notifList.Children.Add(emptyNotice);

        scroll.Content = notifList;
        Grid.SetRow(scroll, 3);
        rootGrid.Children.Add(scroll);

        Child = rootGrid;

        // Add initial system notifications
        AddNotification("Surge Portable Ready", "Desktop environment initialized from USB drive.", "Just now");
        AddNotification("Security Shield Active", "Browser isolated in portable sandbox profile.", "Just now");
    }

    public void AddNotification(string title, string message, string time)
    {
        emptyNotice.Visibility = Visibility.Collapsed;

        var card = new Border
        {
            Background = DeskColors.NavyCard,
            BorderBrush = DeskColors.NavyBorder,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(10),
            Margin = new Thickness(0, 0, 0, 8)
        };
        var stack = new StackPanel();

        var top = new Grid();
        top.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        top.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var t = new TextBlock { Text = title, Foreground = DeskColors.TextPrimary, FontSize = 12, FontWeight = FontWeights.SemiBold };
        Grid.SetColumn(t, 0);
        top.Children.Add(t);

        var tm = new TextBlock { Text = time, Foreground = DeskColors.TextMuted, FontSize = 10 };
        Grid.SetColumn(tm, 1);
        top.Children.Add(tm);

        stack.Children.Add(top);

        var m = new TextBlock { Text = message, Foreground = DeskColors.TextMuted, FontSize = 11.5, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 0, 0) };
        stack.Children.Add(m);

        card.Child = stack;
        notifList.Children.Insert(0, card);
    }

    private void ClearNotifications()
    {
        notifList.Children.Clear();
        emptyNotice.Visibility = Visibility.Visible;
        notifList.Children.Add(emptyNotice);
    }

    private static Border CreateQuickTile(Geometry icon, string title, string status, Action? action = null)
    {
        var tile = new Border
        {
            Background = DeskColors.NavyCard,
            BorderBrush = DeskColors.NavyBorder,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(8),
            Margin = new Thickness(3),
            Cursor = Cursors.Hand
        };
        var stack = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };

        var p = new System.Windows.Shapes.Path
        {
            Data = icon,
            Fill = DeskColors.AccentBlue,
            Width = 16,
            Height = 16,
            Stretch = Stretch.Uniform,
            Margin = new Thickness(0, 0, 0, 4)
        };
        stack.Children.Add(p);

        var t = new TextBlock { Text = title, Foreground = DeskColors.TextPrimary, FontSize = 11, FontWeight = FontWeights.SemiBold, TextAlignment = TextAlignment.Center };
        stack.Children.Add(t);

        var s = new TextBlock { Text = status, Foreground = DeskColors.TextMuted, FontSize = 9.5, TextAlignment = TextAlignment.Center };
        stack.Children.Add(s);

        tile.Child = stack;
        tile.MouseEnter += (_, _) => tile.Background = DeskColors.NavySurfaceHover;
        tile.MouseLeave += (_, _) => tile.Background = DeskColors.NavyCard;
        if (action != null)
            tile.MouseDown += (_, _) => action();
        return tile;
    }

    private static string GetBatteryStatus()
    {
        try
        {
            var power = System.Windows.Forms.SystemInformation.PowerStatus;
            int pct = (int)(power.BatteryLifePercent * 100);
            return $"{pct}% {(power.PowerLineStatus == System.Windows.Forms.PowerLineStatus.Online ? "AC" : "Batt")}";
        }
        catch
        {
            return "100% AC";
        }
    }
}

// ============================================================================
// 4. LOCK SCREEN OVERLAY
// ============================================================================
public sealed class LockScreenControl : Border
{
    private readonly PathManager paths;
    private readonly PasswordBox passBox;
    private readonly TextBlock errorBlock;
    private readonly Action onUnlocked;

    public LockScreenControl(PathManager paths, Action onUnlocked)
    {
        this.paths = paths;
        this.onUnlocked = onUnlocked;

        Background = new SolidColorBrush(Color.FromArgb(235, 7, 11, 20)); // Deep translucent navy
        Visibility = Visibility.Collapsed;

        var centerStack = new StackPanel
        {
            Width = 320,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        };

        // Logo
        var logo = new System.Windows.Shapes.Path
        {
            Data = AppIcons.SurgeLogo,
            Fill = DeskColors.AccentBlue,
            Width = 56,
            Height = 56,
            Stretch = Stretch.Uniform,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 0, 0, 16)
        };
        centerStack.Children.Add(logo);

        var title = new TextBlock
        {
            Text = "SURGE PORTABLE",
            Foreground = Brushes.White,
            FontSize = 22,
            FontWeight = FontWeights.Bold,
            TextAlignment = TextAlignment.Center,
            Margin = new Thickness(0, 0, 0, 6)
        };
        centerStack.Children.Add(title);

        var sub = new TextBlock
        {
            Text = "Workspace Locked. Enter password or use Windows Hello to resume.",
            Foreground = DeskColors.TextMuted,
            FontSize = 12.5,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 24)
        };
        centerStack.Children.Add(sub);

        passBox = new PasswordBox
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
        passBox.KeyDown += (s, e) => { if (e.Key == Key.Enter) Unlock(); };
        centerStack.Children.Add(passBox);

        var unlockBtn = new Button
        {
            Content = "Unlock Workspace",
            Background = DeskColors.AccentBlue,
            Foreground = Brushes.White,
            FontWeight = FontWeights.SemiBold,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(0, 10, 0, 10),
            Cursor = Cursors.Hand,
            Margin = new Thickness(0, 0, 0, 10)
        };
        unlockBtn.Click += (_, _) => Unlock();
        centerStack.Children.Add(unlockBtn);

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
        helloBtn.Click += (_, _) => UnlockWithHello();
        centerStack.Children.Add(helloBtn);

        errorBlock = new TextBlock
        {
            Foreground = new SolidColorBrush(Color.FromRgb(248, 113, 113)),
            FontSize = 12,
            TextAlignment = TextAlignment.Center,
            Visibility = Visibility.Collapsed
        };
        centerStack.Children.Add(errorBlock);

        Child = centerStack;
    }

    public void Show()
    {
        passBox.Password = "";
        errorBlock.Visibility = Visibility.Collapsed;
        Visibility = Visibility.Visible;
        passBox.Focus();
    }

    private void Unlock()
    {
        Visibility = Visibility.Collapsed;
        onUnlocked();
    }

    private void UnlockWithHello()
    {
        if (WindowsHelloService.IsAvailable())
        {
            string? pwd = WindowsHelloService.UnprotectPassword(paths);
            if (pwd != null)
            {
                Visibility = Visibility.Collapsed;
                onUnlocked();
                return;
            }
        }
        errorBlock.Text = "Windows Hello could not unlock. Enter your password.";
        errorBlock.Visibility = Visibility.Visible;
    }
}
