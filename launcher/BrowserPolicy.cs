using System.Text;
using System.Text.Json.Nodes;

namespace SurgePortable;

internal sealed record ProxyServer(string Id, string Name, string Scheme, string Host, int Port)
{
    public string Address => $"{Host}:{Port}";
}

internal sealed class BrowserPolicy
{
    public const string DefaultVerifyUrl = "https://api.ipify.org?format=json";

    private const string ProxyBypass = "localhost, 127.0.0.1";

    public bool SurgeHomepage { get; private init; } = true;
    public bool AllowPrivateBrowsing { get; private init; } = true;
    public bool AutoConnect { get; private init; }
    public bool FailClosed { get; private init; } = true;
    public bool ProtectionRequested { get; private init; }
    public string VerifyUrl { get; private init; } = DefaultVerifyUrl;
    public ProxyServer? Server { get; private init; }
    public List<ProxyServer> Servers { get; private init; } = [];
    public string? ServerId { get; private init; }
    public string? BaselineIp { get; private init; }

    public bool Blocked => ProtectionRequested && Server is null && FailClosed;

    public bool ProtectionActive => ProtectionRequested && (Server is not null || Blocked);

    public string VerifyOrigin => new Uri(VerifyUrl).GetLeftPart(UriPartial.Authority);

    public static BrowserPolicy Load(DocumentStore documents)
    {
        JsonObject settings = ReadObject(documents, "settings");
        JsonObject vpn = ReadObject(documents, "vpn");

        List<ProxyServer> servers = ParseServers(vpn["servers"] as JsonArray);
        string? serverId = vpn["serverId"]?.GetValue<string>();
        bool autoConnect = vpn["autoConnect"]?.GetValue<bool>() ?? false;
        bool requested = (vpn["enabled"]?.GetValue<bool>() ?? false) || autoConnect;

        return new BrowserPolicy
        {
            SurgeHomepage = settings["surgeHomepage"]?.GetValue<bool>() ?? true,
            AllowPrivateBrowsing = settings["allowPrivateBrowsing"]?.GetValue<bool>() ?? true,
            AutoConnect = autoConnect,
            FailClosed = vpn["failClosed"]?.GetValue<bool>() ?? true,
            ProtectionRequested = requested,
            VerifyUrl = NormalizeVerifyUrl(vpn["verifyUrl"]?.GetValue<string>()),
            Servers = servers,
            ServerId = serverId,
            Server = servers.FirstOrDefault(s => s.Id == serverId),
            BaselineIp = NormalizeIp(vpn["baselineIp"]?.GetValue<string>()),
        };
    }

    public static string? NormalizeIp(string? value) =>
        value is { Length: > 0 and <= 45 } && Uri.CheckHostName(value) is UriHostNameType.IPv4 or UriHostNameType.IPv6
            ? value
            : null;

    public IEnumerable<(string Key, string Value)> Preferences(string homepageUrl)
    {
        yield return ("browser.startup.homepage", SurgeHomepage ? homepageUrl : "about:blank");
        yield return ("browser.startup.page", SurgeHomepage ? "1" : "0");

        yield return ("media.peerconnection.enabled", ProtectionActive ? "false" : "true");

        if (!ProtectionActive)
        {
            yield return ("network.proxy.type", "0");
            yield break;
        }

        yield return ("network.proxy.type", "1");
        yield return ("network.proxy.no_proxies_on", ProxyBypass);

        if (Server is null)
        {

            yield return ("network.proxy.socks", "127.0.0.1");
            yield return ("network.proxy.socks_port", "1");
            yield return ("network.proxy.socks_version", "5");
            yield return ("network.proxy.socks_remote_dns", "true");
            yield break;
        }

        if (Server.Scheme == "socks5")
        {
            yield return ("network.proxy.socks", Server.Host);
            yield return ("network.proxy.socks_port", Server.Port.ToString());
            yield return ("network.proxy.socks_version", "5");
            yield return ("network.proxy.socks_remote_dns", "true");
        }
        else
        {
            yield return ("network.proxy.ssl", Server.Host);
            yield return ("network.proxy.ssl_port", Server.Port.ToString());
            yield return ("network.proxy.http", Server.Host);
            yield return ("network.proxy.http_port", Server.Port.ToString());
        }
    }

    public void WritePolicies(PathManager paths)
    {
        string dir = Path.Combine(paths.BrowserDir, "distribution");
        string target = Path.Combine(dir, "policies.json");
        var policies = new JsonObject
        {
            ["policies"] = new JsonObject
            {
                ["DisablePrivateBrowsing"] = !AllowPrivateBrowsing,
                ["DisableFirefoxAccounts"] = true,
                ["DisableTelemetry"] = true,
                ["DisableAppUpdate"] = true,
                ["PasswordManagerEnabled"] = false,
            },
        };

        try
        {
            Directory.CreateDirectory(dir);
            File.WriteAllText(target, policies.ToJsonString(), new UTF8Encoding(false));
        }
        catch (Exception)
        {
        }
    }

    private static JsonObject ReadObject(DocumentStore documents, string name)
    {
        DocumentRead read = documents.Read(name);
        if (read.Status != DocumentReadStatus.Ok)
            return [];
        try
        {
            return JsonNode.Parse(read.Data) as JsonObject ?? [];
        }
        catch (System.Text.Json.JsonException)
        {
            return [];
        }
    }

    private static List<ProxyServer> ParseServers(JsonArray? array)
    {
        var servers = new List<ProxyServer>();
        if (array is null)
            return servers;

        foreach (JsonNode? node in array)
        {
            if (node is not JsonObject item)
                continue;
            ProxyServer? server = ParseServer(item);
            if (server is not null && servers.All(s => s.Id != server.Id))
                servers.Add(server);
        }
        return servers;
    }

    public static ProxyServer? ParseServer(JsonObject item)
    {
        string? id = item["id"]?.GetValue<string>();
        string? host = item["host"]?.GetValue<string>()?.Trim();
        string scheme = item["scheme"]?.GetValue<string>() ?? "socks5";
        int port = item["port"]?.GetValue<int>() ?? 0;

        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(host))
            return null;
        if (scheme is not ("socks5" or "https"))
            return null;
        if (port is < 1 or > 65535)
            return null;
        if (host.Length > 253 || Uri.CheckHostName(host) == UriHostNameType.Unknown)
            return null;

        string name = item["name"]?.GetValue<string>()?.Trim() is { Length: > 0 } label ? label : host;
        return new ProxyServer(id, name[..Math.Min(name.Length, 80)], scheme, host, port);
    }

    public static string NormalizeVerifyUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return DefaultVerifyUrl;
        if (!Uri.TryCreate(value, UriKind.Absolute, out Uri? uri))
            return DefaultVerifyUrl;
        if (uri.Scheme != Uri.UriSchemeHttps || uri.UserInfo.Length > 0 || uri.IsLoopback)
            return DefaultVerifyUrl;

        return value;
    }
}
