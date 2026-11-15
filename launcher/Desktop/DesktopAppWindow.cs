using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Shapes;

namespace SurgePortable.Desktop;

public enum WindowResizeEdge
{
    None,
    Left,
    Right,
    Top,
    Bottom,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight
}

/// <summary>
/// A lightweight, draggable, resizable internal application window for the Surge desktop workspace.
/// </summary>
public sealed class DesktopAppWindow : Border
{
    private readonly Border titleBar;
    private readonly TextBlock titleBlock;
    private readonly System.Windows.Shapes.Path iconPath;
    private readonly ContentControl contentHost;
    private readonly Button minBtn;
    private readonly Button maxBtn;
    private readonly Button closeBtn;
    private readonly System.Windows.Shapes.Path maxBtnIcon;

    private Point dragStartCursor;
    private Point dragStartWindowPos;
    private bool isDragging;

    private WindowResizeEdge currentResizeEdge = WindowResizeEdge.None;
    private Point resizeStartCursor;
    private Rect resizeStartBounds;
    private bool isResizing;

    public string AppId { get; }
    public Rect RestoreBounds { get; set; }
    public bool IsMaximized { get; private set; }
    public bool IsMinimized { get; private set; }
    public bool IsActive { get; private set; }

    public event Action<DesktopAppWindow>? Activated;
    public event Action<DesktopAppWindow>? Closed;
    public event Action<DesktopAppWindow>? MinimizedStateChanged;

    public DesktopAppWindow(string appId, string title, Geometry icon, Brush iconBrush, UIElement content)
    {
        AppId = appId;
        CornerRadius = new CornerRadius(8);
        Background = DeskColors.NavySurface;
        BorderBrush = DeskColors.NavyBorder;
        BorderThickness = new Thickness(1);
        ClipToBounds = false;
        MinWidth = 360;
        MinHeight = 260;

        Effect = new DropShadowEffect
        {
            BlurRadius = 24,
            ShadowDepth = 8,
            Direction = 270,
            Opacity = 0.55,
            Color = Colors.Black
        };

        var rootGrid = new Grid();
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(38) }); // Title bar
        rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // Content

        // --- TITLE BAR ---
        titleBar = new Border
        {
            Background = DeskColors.NavyCard,
            CornerRadius = new CornerRadius(8, 8, 0, 0),
            BorderThickness = new Thickness(0, 0, 0, 1),
            BorderBrush = DeskColors.NavyBorder,
            Cursor = Cursors.Arrow
        };
        Grid.SetRow(titleBar, 0);

        var titleGrid = new Grid();
        titleGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Icon
        titleGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); // Title text
        titleGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // Window buttons

        // Icon
        iconPath = new System.Windows.Shapes.Path
        {
            Data = icon,
            Fill = iconBrush,
            Width = 16,
            Height = 16,
            Stretch = Stretch.Uniform,
            Margin = new Thickness(12, 0, 8, 0),
            VerticalAlignment = VerticalAlignment.Center
        };
        Grid.SetColumn(iconPath, 0);
        titleGrid.Children.Add(iconPath);

        // Title text
        titleBlock = new TextBlock
        {
            Text = title,
            Foreground = DeskColors.TextPrimary,
            FontSize = 12.5,
            FontWeight = FontWeights.SemiBold,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            Margin = new Thickness(0, 0, 8, 0)
        };
        Grid.SetColumn(titleBlock, 1);
        titleGrid.Children.Add(titleBlock);

        // Window control buttons
        var btnPanel = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 4, 0)
        };
        Grid.SetColumn(btnPanel, 2);

        minBtn = CreateCaptionButton(AppIcons.Minimize, DeskColors.TextMuted, 36, 28, "Minimize");
        minBtn.Click += (_, _) => ToggleMinimize();
        btnPanel.Children.Add(minBtn);

        maxBtnIcon = new System.Windows.Shapes.Path
        {
            Data = AppIcons.Maximize,
            Fill = DeskColors.TextMuted,
            Width = 11,
            Height = 11,
            Stretch = Stretch.Uniform
        };
        maxBtn = new Button
        {
            Content = maxBtnIcon,
            Width = 36,
            Height = 28,
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            Cursor = Cursors.Hand,
            ToolTip = "Maximize"
        };
        ApplyHoverStyle(maxBtn, DeskColors.NavySurfaceHover);
        maxBtn.Click += (_, _) => ToggleMaximize();
        btnPanel.Children.Add(maxBtn);

        closeBtn = CreateCaptionButton(AppIcons.Close, DeskColors.TextMuted, 38, 28, "Close");
        ApplyHoverStyle(closeBtn, new SolidColorBrush(Color.FromRgb(220, 38, 38)));
        closeBtn.Click += (_, _) => Close();
        btnPanel.Children.Add(closeBtn);

        titleBar.Child = titleGrid;
        rootGrid.Children.Add(titleBar);

        // --- CONTENT HOST ---
        contentHost = new ContentControl
        {
            Content = content,
            ClipToBounds = true
        };
        Grid.SetRow(contentHost, 1);
        rootGrid.Children.Add(contentHost);

        // --- RESIZE BORDER OVERLAYS ---
        AttachResizeGrips(rootGrid);

        Child = rootGrid;

        // Mouse handlers for dragging & activation
        titleBar.MouseLeftButtonDown += TitleBar_MouseLeftButtonDown;
        titleBar.MouseMove += TitleBar_MouseMove;
        titleBar.MouseLeftButtonUp += TitleBar_MouseLeftButtonUp;

        MouseDown += (_, _) => Activate();
    }

    public string Title
    {
        get => titleBlock.Text;
        set => titleBlock.Text = value;
    }

    public void SetActive(bool active)
    {
        IsActive = active;
        if (active)
        {
            BorderBrush = DeskColors.AccentBlue;
            titleBar.Background = DeskColors.NavySurface;
            titleBlock.Foreground = DeskColors.TextPrimary;
            Effect = new DropShadowEffect
            {
                BlurRadius = 32,
                ShadowDepth = 10,
                Direction = 270,
                Opacity = 0.75,
                Color = Colors.Black
            };
        }
        else
        {
            BorderBrush = DeskColors.NavyBorder;
            titleBar.Background = DeskColors.NavyCard;
            titleBlock.Foreground = DeskColors.TextMuted;
            Effect = new DropShadowEffect
            {
                BlurRadius = 16,
                ShadowDepth = 4,
                Direction = 270,
                Opacity = 0.4,
                Color = Colors.Black
            };
        }
    }

    public void Activate()
    {
        if (IsMinimized)
        {
            RestoreFromMinimized();
        }
        SetActive(true);
        Activated?.Invoke(this);
    }

    public void ToggleMinimize()
    {
        if (IsMinimized)
        {
            RestoreFromMinimized();
        }
        else
        {
            IsMinimized = true;
            Visibility = Visibility.Collapsed;
            MinimizedStateChanged?.Invoke(this);
        }
    }

    public void RestoreFromMinimized()
    {
        IsMinimized = false;
        Visibility = Visibility.Visible;
        MinimizedStateChanged?.Invoke(this);
        Activate();
    }

    public void ToggleMaximize()
    {
        if (Parent is not Canvas canvas) return;

        if (IsMaximized)
        {
            // Restore
            Canvas.SetLeft(this, RestoreBounds.X);
            Canvas.SetTop(this, RestoreBounds.Y);
            Width = RestoreBounds.Width;
            Height = RestoreBounds.Height;
            IsMaximized = false;
            maxBtnIcon.Data = AppIcons.Maximize;
            maxBtn.ToolTip = "Maximize";
            CornerRadius = new CornerRadius(8);
            titleBar.CornerRadius = new CornerRadius(8, 8, 0, 0);
        }
        else
        {
            // Maximize
            RestoreBounds = new Rect(Canvas.GetLeft(this), Canvas.GetTop(this), ActualWidth, ActualHeight);
            Canvas.SetLeft(this, 0);
            Canvas.SetTop(this, 0);
            Width = canvas.ActualWidth;
            Height = canvas.ActualHeight;
            IsMaximized = true;
            maxBtnIcon.Data = AppIcons.Restore;
            maxBtn.ToolTip = "Restore";
            CornerRadius = new CornerRadius(0);
            titleBar.CornerRadius = new CornerRadius(0);
        }
    }

    public void Close()
    {
        Closed?.Invoke(this);
    }

    public void UpdateMaximizedSize(double availableWidth, double availableHeight)
    {
        if (IsMaximized)
        {
            Canvas.SetLeft(this, 0);
            Canvas.SetTop(this, 0);
            Width = availableWidth;
            Height = availableHeight;
        }
    }

    private void TitleBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        Activate();
        if (e.ClickCount == 2)
        {
            ToggleMaximize();
            return;
        }

        if (IsMaximized) return;

        isDragging = true;
        titleBar.CaptureMouse();
        dragStartCursor = e.GetPosition(Parent as IInputElement);
        dragStartWindowPos = new Point(Canvas.GetLeft(this), Canvas.GetTop(this));
    }

    private void TitleBar_MouseMove(object sender, MouseEventArgs e)
    {
        if (!isDragging || Parent is not Canvas canvas) return;

        Point currentCursor = e.GetPosition(canvas);
        double deltaX = currentCursor.X - dragStartCursor.X;
        double deltaY = currentCursor.Y - dragStartCursor.Y;

        double newLeft = dragStartWindowPos.X + deltaX;
        double newTop = dragStartWindowPos.Y + deltaY;

        // Clamp inside canvas bounds
        newLeft = Math.Clamp(newLeft, -ActualWidth + 80, canvas.ActualWidth - 80);
        newTop = Math.Clamp(newTop, 0, canvas.ActualHeight - 40);

        Canvas.SetLeft(this, newLeft);
        Canvas.SetTop(this, newTop);
    }

    private void TitleBar_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        if (isDragging)
        {
            isDragging = false;
            titleBar.ReleaseMouseCapture();
        }
    }

    private void AttachResizeGrips(Grid rootGrid)
    {
        const double gripThickness = 6;

        AddResizeHandle(rootGrid, WindowResizeEdge.Left, HorizontalAlignment.Left, VerticalAlignment.Stretch, gripThickness, double.NaN, Cursors.SizeWE);
        AddResizeHandle(rootGrid, WindowResizeEdge.Right, HorizontalAlignment.Right, VerticalAlignment.Stretch, gripThickness, double.NaN, Cursors.SizeWE);
        AddResizeHandle(rootGrid, WindowResizeEdge.Top, HorizontalAlignment.Stretch, VerticalAlignment.Top, double.NaN, gripThickness, Cursors.SizeNS);
        AddResizeHandle(rootGrid, WindowResizeEdge.Bottom, HorizontalAlignment.Stretch, VerticalAlignment.Bottom, double.NaN, gripThickness, Cursors.SizeNS);

        AddResizeHandle(rootGrid, WindowResizeEdge.TopLeft, HorizontalAlignment.Left, VerticalAlignment.Top, gripThickness * 2, gripThickness * 2, Cursors.SizeNWSE);
        AddResizeHandle(rootGrid, WindowResizeEdge.TopRight, HorizontalAlignment.Right, VerticalAlignment.Top, gripThickness * 2, gripThickness * 2, Cursors.SizeNESW);
        AddResizeHandle(rootGrid, WindowResizeEdge.BottomLeft, HorizontalAlignment.Left, VerticalAlignment.Bottom, gripThickness * 2, gripThickness * 2, Cursors.SizeNESW);
        AddResizeHandle(rootGrid, WindowResizeEdge.BottomRight, HorizontalAlignment.Right, VerticalAlignment.Bottom, gripThickness * 2, gripThickness * 2, Cursors.SizeNWSE);
    }

    private void AddResizeHandle(Grid grid, WindowResizeEdge edge, HorizontalAlignment hAlign, VerticalAlignment vAlign, double width, double height, Cursor cursor)
    {
        var grip = new Border
        {
            Background = Brushes.Transparent,
            HorizontalAlignment = hAlign,
            VerticalAlignment = vAlign,
            Cursor = cursor
        };
        if (!double.IsNaN(width)) grip.Width = width;
        if (!double.IsNaN(height)) grip.Height = height;

        Grid.SetRowSpan(grip, 2);

        grip.MouseLeftButtonDown += (s, e) =>
        {
            if (IsMaximized || Parent is not Canvas canvas) return;
            isResizing = true;
            currentResizeEdge = edge;
            grip.CaptureMouse();
            resizeStartCursor = e.GetPosition(canvas);
            resizeStartBounds = new Rect(Canvas.GetLeft(this), Canvas.GetTop(this), ActualWidth, ActualHeight);
            e.Handled = true;
        };

        grip.MouseMove += (s, e) =>
        {
            if (!isResizing || Parent is not Canvas canvas) return;
            Point current = e.GetPosition(canvas);
            double dx = current.X - resizeStartCursor.X;
            double dy = current.Y - resizeStartCursor.Y;

            double newLeft = resizeStartBounds.X;
            double newTop = resizeStartBounds.Y;
            double newWidth = resizeStartBounds.Width;
            double newHeight = resizeStartBounds.Height;

            switch (currentResizeEdge)
            {
                case WindowResizeEdge.Right:
                    newWidth = Math.Max(MinWidth, resizeStartBounds.Width + dx);
                    break;
                case WindowResizeEdge.Bottom:
                    newHeight = Math.Max(MinHeight, resizeStartBounds.Height + dy);
                    break;
                case WindowResizeEdge.Left:
                    double wL = resizeStartBounds.Width - dx;
                    if (wL >= MinWidth) { newLeft = resizeStartBounds.X + dx; newWidth = wL; }
                    break;
                case WindowResizeEdge.Top:
                    double hT = resizeStartBounds.Height - dy;
                    if (hT >= MinHeight) { newTop = resizeStartBounds.Y + dy; newHeight = hT; }
                    break;
                case WindowResizeEdge.BottomRight:
                    newWidth = Math.Max(MinWidth, resizeStartBounds.Width + dx);
                    newHeight = Math.Max(MinHeight, resizeStartBounds.Height + dy);
                    break;
                case WindowResizeEdge.BottomLeft:
                    double wBL = resizeStartBounds.Width - dx;
                    if (wBL >= MinWidth) { newLeft = resizeStartBounds.X + dx; newWidth = wBL; }
                    newHeight = Math.Max(MinHeight, resizeStartBounds.Height + dy);
                    break;
                case WindowResizeEdge.TopRight:
                    newWidth = Math.Max(MinWidth, resizeStartBounds.Width + dx);
                    double hTR = resizeStartBounds.Height - dy;
                    if (hTR >= MinHeight) { newTop = resizeStartBounds.Y + dy; newHeight = hTR; }
                    break;
                case WindowResizeEdge.TopLeft:
                    double wTL = resizeStartBounds.Width - dx;
                    if (wTL >= MinWidth) { newLeft = resizeStartBounds.X + dx; newWidth = wTL; }
                    double hTL = resizeStartBounds.Height - dy;
                    if (hTL >= MinHeight) { newTop = resizeStartBounds.Y + dy; newHeight = hTL; }
                    break;
            }

            Canvas.SetLeft(this, newLeft);
            Canvas.SetTop(this, newTop);
            Width = newWidth;
            Height = newHeight;
            e.Handled = true;
        };

        grip.MouseLeftButtonUp += (s, e) =>
        {
            if (isResizing)
            {
                isResizing = false;
                grip.ReleaseMouseCapture();
                currentResizeEdge = WindowResizeEdge.None;
                e.Handled = true;
            }
        };

        grid.Children.Add(grip);
    }

    private static Button CreateCaptionButton(Geometry icon, Brush brush, double width, double height, string tooltip)
    {
        var path = new System.Windows.Shapes.Path
        {
            Data = icon,
            Fill = brush,
            Width = 11,
            Height = 11,
            Stretch = Stretch.Uniform
        };
        var btn = new Button
        {
            Content = path,
            Width = width,
            Height = height,
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            Cursor = Cursors.Hand,
            ToolTip = tooltip
        };
        ApplyHoverStyle(btn, DeskColors.NavySurfaceHover);
        return btn;
    }

    private static void ApplyHoverStyle(Button btn, Brush hoverBrush)
    {
        btn.MouseEnter += (_, _) => btn.Background = hoverBrush;
        btn.MouseLeave += (_, _) => btn.Background = Brushes.Transparent;
    }
}
