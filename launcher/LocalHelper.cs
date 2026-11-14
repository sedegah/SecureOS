using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;

namespace SurgePortable;

/// Minimal loopback-only HTTP server. It uses a raw socket instead of http.sys so that Surge
/// needs no administrator rights, no URL reservation and no host installation.
internal sealed class LocalHelper : IDisposable
{
    private const int MaxHeaderBytes = 16 * 1024;
    private const long MaxBodyBytes = PathManager.MaxDocumentBytes + 1024 * 1024;

    private static readonly Dictionary<string, string> ContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".html"] = "text/html; charset=utf-8",
        [".css"] = "text/css; charset=utf-8",
        [".js"] = "text/javascript; charset=utf-8",
        [".mjs"] = "text/javascript; charset=utf-8",
        [".json"] = "application/json; charset=utf-8",
        [".svg"] = "image/svg+xml",
        [".png"] = "image/png",
        [".jpg"] = "image/jpeg",
        [".ico"] = "image/x-icon",
        [".wasm"] = "application/wasm",
        [".woff2"] = "font/woff2",
        [".txt"] = "text/plain; charset=utf-8",
    };

    private const string ContentSecurityPolicy =
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; " +
        "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

    private readonly PathManager paths;
    private readonly Api api;
    private readonly string token;
    private readonly TcpListener listener;
    private readonly CancellationTokenSource shutdown = new();
    private readonly SemaphoreSlim concurrency = new(16, 16);
    private long lastHeartbeatTicks = DateTime.UtcNow.Ticks;

    public LocalHelper(PathManager paths, string token)
    {
        this.paths = paths;
        this.token = token;
        api = new Api(paths, new DocumentStore(paths), new FileOperations(paths));
        listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        Port = ((IPEndPoint)listener.LocalEndpoint).Port;
        _ = Task.Run(AcceptLoopAsync);
    }

    public int Port { get; }
    public string Origin => $"http://127.0.0.1:{Port}";
    public string HomepageUrl => $"{Origin}/#k={token}";

    public static string CreateToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();

    public void Dispose()
    {
        shutdown.Cancel();
        listener.Stop();
        concurrency.Dispose();
        shutdown.Dispose();
    }

    private async Task AcceptLoopAsync()
    {
        while (!shutdown.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await listener.AcceptTcpClientAsync(shutdown.Token);
            }
            catch (Exception ex) when (ex is OperationCanceledException or SocketException or ObjectDisposedException)
            {
                return;
            }

            _ = Task.Run(() => HandleClientAsync(client));
        }
    }

    private async Task HandleClientAsync(TcpClient client)
    {
        if (!await concurrency.WaitAsync(TimeSpan.FromSeconds(10), shutdown.Token).ConfigureAwait(false))
        {
            client.Dispose();
            return;
        }

        try
        {
            using (client)
            {
                client.NoDelay = true;
                client.ReceiveTimeout = 20000;
                client.SendTimeout = 20000;
                await using NetworkStream stream = client.GetStream();
                await ServeAsync(stream).ConfigureAwait(false);
            }
        }
        catch (Exception ex) when (ex is IOException or SocketException or ObjectDisposedException or OperationCanceledException)
        {
            // A closed browser tab or an aborted request is not an application error.
        }
        finally
        {
            concurrency.Release();
        }
    }

    private async Task ServeAsync(NetworkStream stream)
    {
        HttpRequest? request = await ReadRequestAsync(stream).ConfigureAwait(false);
        if (request is null)
            return;

        ApiResponse response = Route(request);
        await WriteResponseAsync(stream, response).ConfigureAwait(false);
    }

    private ApiResponse Route(HttpRequest request)
    {
        if (!IsAllowedHost(request.Headers))
            return ApiResponse.Error(403, "host", "Surge only answers requests addressed to its own local address.");

        if (request.Headers.TryGetValue("sec-fetch-site", out string? site) && site is not ("same-origin" or "none"))
            return ApiResponse.Error(403, "cross-site", "Surge does not accept requests from other websites.");

        if (request.Headers.TryGetValue("origin", out string? origin) && !origin.Equals(Origin, StringComparison.OrdinalIgnoreCase))
            return ApiResponse.Error(403, "origin", "Surge does not accept requests from other origins.");

        if (request.Path.StartsWith("/api/", StringComparison.Ordinal))
        {
            if (!request.Headers.TryGetValue("x-surge-token", out string? supplied) || !FixedTimeEquals(supplied, token))
                return ApiResponse.Error(401, "token", "This page is not authorised to use the Surge workspace helper.");

            return api.Handle(request.Method, request.Path, request.Query, request.Body,
                () => Interlocked.Exchange(ref lastHeartbeatTicks, DateTime.UtcNow.Ticks));
        }

        if (request.Method != "GET")
            return ApiResponse.Error(405, "method", "Unsupported method.");

        return ServeStatic(request.Path);
    }

    private ApiResponse ServeStatic(string requestPath)
    {
        string relative = requestPath == "/" ? "index.html" : requestPath.TrimStart('/');
        string decoded;
        try
        {
            decoded = Uri.UnescapeDataString(relative);
        }
        catch (UriFormatException)
        {
            return ApiResponse.Error(400, "bad-path", "Malformed request path.");
        }

        if (decoded.Contains('\0') || decoded.Contains(':') || decoded.Split(['/', '\\']).Any(p => p == ".."))
            return ApiResponse.Error(400, "bad-path", "Malformed request path.");

        string full = Path.GetFullPath(Path.Combine(paths.InterfaceDir, decoded));
        if (!full.StartsWith(paths.InterfaceDir + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            return ApiResponse.Error(400, "bad-path", "Malformed request path.");

        if (!File.Exists(full))
            return ApiResponse.Error(404, "not-found", "That interface file is missing from the USB drive.");

        string type = ContentTypes.GetValueOrDefault(Path.GetExtension(full), "application/octet-stream");
        return new ApiResponse(200, type, File.ReadAllBytes(full));
    }

    private bool IsAllowedHost(Dictionary<string, string> headers)
    {
        if (!headers.TryGetValue("host", out string? host))
            return false;
        return host.Equals($"127.0.0.1:{Port}", StringComparison.OrdinalIgnoreCase)
            || host.Equals($"localhost:{Port}", StringComparison.OrdinalIgnoreCase);
    }

    private static bool FixedTimeEquals(string? supplied, string expected)
    {
        if (supplied is null)
            return false;
        byte[] a = Encoding.UTF8.GetBytes(supplied);
        byte[] b = Encoding.UTF8.GetBytes(expected);
        return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
    }

    private static async Task<HttpRequest?> ReadRequestAsync(NetworkStream stream)
    {
        byte[] buffer = new byte[8192];
        using var header = new MemoryStream();
        int headerEnd = -1;

        while (headerEnd < 0)
        {
            int read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length)).ConfigureAwait(false);
            if (read == 0)
                return null;
            header.Write(buffer, 0, read);
            if (header.Length > MaxHeaderBytes)
                return null;
            headerEnd = FindHeaderEnd(header.GetBuffer(), (int)header.Length);
        }

        byte[] raw = header.ToArray();
        string text = Encoding.UTF8.GetString(raw, 0, headerEnd);
        string[] lines = text.Split("\r\n");
        string[] requestLine = lines[0].Split(' ');
        if (requestLine.Length < 2)
            return null;

        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (string line in lines.Skip(1))
        {
            int colon = line.IndexOf(':');
            if (colon > 0)
                headers[line[..colon].Trim()] = line[(colon + 1)..].Trim();
        }

        string target = requestLine[1];
        int q = target.IndexOf('?');
        string path = q < 0 ? target : target[..q];
        string? query = q < 0 ? null : target[(q + 1)..];

        long length = 0;
        if (headers.TryGetValue("content-length", out string? lengthText) && !long.TryParse(lengthText, out length))
            return null;
        if (length < 0 || length > MaxBodyBytes)
            return null;

        using var body = new MemoryStream();
        int alreadyRead = (int)header.Length - (headerEnd + 4);
        if (alreadyRead > 0)
            body.Write(raw, headerEnd + 4, alreadyRead);

        while (body.Length < length)
        {
            int read = await stream.ReadAsync(buffer.AsMemory(0, (int)Math.Min(buffer.Length, length - body.Length))).ConfigureAwait(false);
            if (read == 0)
                return null;
            body.Write(buffer, 0, read);
        }

        return new HttpRequest(requestLine[0].ToUpperInvariant(), path, query, headers, body.ToArray());
    }

    private static int FindHeaderEnd(byte[] data, int length)
    {
        for (int i = 3; i < length; i++)
        {
            if (data[i - 3] == '\r' && data[i - 2] == '\n' && data[i - 1] == '\r' && data[i] == '\n')
                return i - 3;
        }
        return -1;
    }

    private static async Task WriteResponseAsync(NetworkStream stream, ApiResponse response)
    {
        var head = new StringBuilder();
        head.Append("HTTP/1.1 ").Append(response.Status).Append(' ').Append(StatusText(response.Status)).Append("\r\n");
        head.Append("Content-Type: ").Append(response.ContentType).Append("\r\n");
        head.Append("Content-Length: ").Append(response.Body.Length).Append("\r\n");
        head.Append("Connection: close\r\n");
        head.Append("Cache-Control: no-store\r\n");
        head.Append("X-Content-Type-Options: nosniff\r\n");
        head.Append("Referrer-Policy: no-referrer\r\n");
        if (response.ContentType.StartsWith("text/html", StringComparison.Ordinal))
            head.Append("Content-Security-Policy: ").Append(ContentSecurityPolicy).Append("\r\n");
        if (response.SourceHeader is not null)
            head.Append("X-Surge-Source: ").Append(response.SourceHeader).Append("\r\n");
        head.Append("\r\n");

        byte[] headBytes = Encoding.UTF8.GetBytes(head.ToString());
        await stream.WriteAsync(headBytes).ConfigureAwait(false);
        if (response.Body.Length > 0)
            await stream.WriteAsync(response.Body).ConfigureAwait(false);
        await stream.FlushAsync().ConfigureAwait(false);
    }

    private static string StatusText(int status) => status switch
    {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        413 => "Payload Too Large",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "Unknown",
    };

    private sealed record HttpRequest(string Method, string Path, string? Query, Dictionary<string, string> Headers, byte[] Body);
}