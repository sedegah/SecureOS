using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace SurgePortable.Desktop;

internal sealed class SplashScreenWindow : Window
{
    private readonly ProgressBar progressBar;
    private readonly TextBlock lblStatus;

    public SplashScreenWindow()
    {
        Title = "Surge Portable";
        Width = 640;
        Height = 360;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        Background = Brushes.Transparent;
        AllowsTransparency = true;
        ShowInTaskbar = false;
        Topmost = true;

        var outerBorder = new Border
        {
            CornerRadius = new CornerRadius(12),
            Background = new SolidColorBrush(Color.FromRgb(8, 13, 26)),
            BorderBrush = new SolidColorBrush(Color.FromArgb(90, 37, 99, 235)),
            BorderThickness = new Thickness(1.5),
            ClipToBounds = true
        };

        var grid = new Grid();

        // Banner Image
        var img = new Image
        {
            Stretch = Stretch.UniformToFill,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center
        };

        try
        {
            var asm = Assembly.GetExecutingAssembly();
            using var s = asm.GetManifestResourceStream("splash.jpg");
            if (s != null)
            {
                var bmp = new BitmapImage();
                bmp.BeginInit();
                bmp.StreamSource = s;
                bmp.CacheOption = BitmapCacheOption.OnLoad;
                bmp.EndInit();
                img.Source = bmp;
            }
        }
        catch { }

        grid.Children.Add(img);

        // Bottom gradient overlay for progress
        var overlay = new Border
        {
            VerticalAlignment = VerticalAlignment.Bottom,
            Height = 100,
            Background = new LinearGradientBrush(
                Color.FromArgb(0, 8, 13, 26),
                Color.FromArgb(240, 8, 13, 26),
                90.0)
        };
        grid.Children.Add(overlay);

        var stack = new StackPanel
        {
            VerticalAlignment = VerticalAlignment.Bottom,
            Margin = new Thickness(24, 0, 24, 20)
        };

        lblStatus = new TextBlock
        {
            Text = "Starting Surge Portable…",
            Foreground = new SolidColorBrush(Color.FromRgb(226, 232, 240)),
            FontFamily = new FontFamily("Segoe UI"),
            FontSize = 12.5,
            FontWeight = FontWeights.Medium,
            Margin = new Thickness(0, 0, 0, 8)
        };
        stack.Children.Add(lblStatus);

        progressBar = new ProgressBar
        {
            Height = 4,
            Foreground = new SolidColorBrush(Color.FromRgb(37, 99, 235)),
            Background = new SolidColorBrush(Color.FromArgb(50, 255, 255, 255)),
            BorderThickness = new Thickness(0),
            Minimum = 0,
            Maximum = 100,
            Value = 10
        };
        stack.Children.Add(progressBar);

        grid.Children.Add(stack);
        outerBorder.Child = grid;
        Content = outerBorder;
    }

    public void UpdateProgress(double pct, string text)
    {
        Dispatcher.Invoke(() =>
        {
            progressBar.Value = Math.Clamp(pct, 0, 100);
            lblStatus.Text = text;
        });
    }
}
