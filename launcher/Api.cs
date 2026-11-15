using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace SurgePortable;

internal sealed record ApiResponse(int Status, string ContentType, byte[] Body, string? SourceHeader = null)
{
    public static ApiResponse Json(int status, JsonNode node, string? sourceHeader = null) =>
        new(status, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(node.ToJsonString()), sourceHeader);

    public static ApiResponse Error(int status, string code, string message) =>
        Json(status, new JsonObject { ["error"] = code, ["message"] = message });

    public static ApiResponse Raw(int status, byte[] body, string? sourceHeader = null) =>
        new(status, "application/json; charset=utf-8", body, sourceHeader);

    public static ApiResponse File(int status, byte[] body, string contentType) =>
        new(status, contentType, body, null);
}

internal interface IBrowserControl
{
    bool BrowserRunning { get; }
    void RequestRestart();
}

internal sealed class Api(PathManager paths, DocumentStore documents, FileOperations files, IBrowserControl browser)
{
    public const string Version = "1.0.0";
    private readonly VaultFileStore vaultFiles = new(paths);

    public ApiResponse Handle(string method, string path, string? query, byte[] body, Action heartbeat)
    {
        if (path == "/api/heartbeat")
        {
            heartbeat();
            return ApiResponse.Json(200, new JsonObject { ["ok"] = true, ["usbPresent"] = paths.UsbPresent });
        }

        if (path == "/api/status")
            return Status();

        if (!paths.UsbPresent)
            return ApiResponse.Error(503, "usb-missing",
                "The Surge USB drive is not available. Reconnect the drive, then try again. No files were written to this computer.");

        try
        {
            if (path.StartsWith("/api/doc/", StringComparison.Ordinal))
            {
                string name = path["/api/doc/".Length..];
                if (!DocumentStore.IsAllowed(name) || name == "vault")
                    return ApiResponse.Error(404, "unknown-document", "Unknown workspace document.");
                return method switch
                {
                    "GET" => ReadDocument(name),
                    "PUT" => WriteDocument(name, body),
                    _ => ApiResponse.Error(405, "method", "Unsupported method."),
                };
            }

            if (path == "/api/vault")
                return method switch
                {
                    "GET" => ReadDocument("vault"),
                    "PUT" => WriteDocument("vault", body, PathManager.MaxVaultBytes),
                    _ => ApiResponse.Error(405, "method", "Unsupported method."),
                };

            if (path.StartsWith("/api/vault/files/", StringComparison.Ordinal))
            {
                string id = path["/api/vault/files/".Length..];
                if (!VaultFileStore.IsValidId(id))
                    return ApiResponse.Error(400, "bad-id", "An attachment ID must be a canonical lowercase UUID.");
                return VaultFile(method, id, body);
            }

            if (path == "/api/vpn/state" && method == "GET")
                return VpnState();

            if (path == "/api/vpn/apply" && method == "POST")
                return VpnApply(body);

            if (path == "/api/files" && method == "GET")
            {
                string dir = ResolveOrdinaryPath(QueryValue(query, "path"), allowRoot: true);
                return ApiResponse.Json(200, files.List(dir));
            }

            if (path == "/api/files/raw" && method == "GET")
            {
                string filePath = ResolveOrdinaryPath(QueryValue(query, "path"));
                if (!System.IO.File.Exists(filePath))
                    return ApiResponse.Error(404, "not-found", "File not found.");

                byte[] bytes = System.IO.File.ReadAllBytes(filePath);
                string ext = Path.GetExtension(filePath).ToLowerInvariant();
                string contentType = ext switch
                {
                    ".pdf" => "application/pdf",
                    ".png" => "image/png",
                    ".jpg" or ".jpeg" => "image/jpeg",
                    ".gif" => "image/gif",
                    ".webp" => "image/webp",
                    ".svg" => "image/svg+xml",
                    ".bmp" => "image/bmp",
                    ".ico" => "image/x-icon",
                    ".txt" or ".log" => "text/plain; charset=utf-8",
                    ".json" => "application/json; charset=utf-8",
                    _ => "application/octet-stream"
                };
                return ApiResponse.File(200, bytes, contentType);
            }

            if (path == "/api/biometric/status" && method == "GET")
                return BiometricStatus();

            if (path == "/api/biometric/verify" && method == "POST")
                return BiometricVerify(body);

            if (path.StartsWith("/api/files/", StringComparison.Ordinal) && method == "POST")
                return FileAction(path["/api/files/".Length..], body);

            return ApiResponse.Error(404, "not-found", "Unknown Surge endpoint.");
        }
        catch (FileOperationException ex)
        {
            return ApiResponse.Error(ex.Status, "file-error", ex.Message);
        }
        catch (InvalidDataException ex)
        {
            return ApiResponse.Error(400, "bad-data", ex.Message);
        }
        catch (JsonException)
        {
            return ApiResponse.Error(400, "bad-data", "The request body must be valid JSON.");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return ApiResponse.Error(500, "io-error",
                "Surge could not complete that operation on the USB drive: " + ex.Message);
        }
    }

    private ApiResponse Status()
    {
        bool present = paths.UsbPresent;
        var payload = new JsonObject
        {
            ["app"] = paths.IsInstalled ? "Surge Desktop" : "Surge Portable",
            ["version"] = Version,
            ["installed"] = paths.IsInstalled,
            ["usbPresent"] = present,
            ["usbRoot"] = paths.Root,
            ["paths"] = new JsonObject
            {
                ["downloads"] = "Downloads",
                ["notes"] = "Data/Notes",
                ["bookmarks"] = "Data/Bookmarks",
                ["vault"] = "Data/PasswordVault",
                ["profile"] = "Data/Profile",
            },
        };

        if (present)
        {
            try
            {
                StorageInfo storage = paths.GetStorage();
                payload["storage"] = new JsonObject
                {
                    ["total"] = storage.TotalBytes,
                    ["free"] = storage.FreeBytes,
                    ["used"] = storage.UsedBytes,
                    ["low"] = storage.LowSpace,
                    ["critical"] = storage.CriticalSpace,
                };
            }
            catch (Exception ex) when (ex is IOException or ArgumentException or UnauthorizedAccessException)
            {
                payload["storage"] = null;
            }
        }

        return ApiResponse.Json(200, payload);
    }

    private ApiResponse ReadDocument(string name)
    {
        DocumentRead read = documents.Read(name);
        return read.Status switch
        {
            DocumentReadStatus.NotFound => ApiResponse.Error(404, "not-created", "This workspace file has not been created yet."),
            DocumentReadStatus.Corrupt => ApiResponse.Error(500, "corrupt",
                "This workspace file is damaged and no usable backup was found. Restore it from your own backup before saving over it."),
            _ => ApiResponse.Raw(200, read.Data, read.FromBackup ? "backup" : null),
        };
    }

    private ApiResponse WriteDocument(string name, byte[] body, long? limit = null)
    {
        if (body.Length > (limit ?? PathManager.MaxDocumentBytes))
            return ApiResponse.Error(413, "too-large", "That workspace file is larger than Surge allows.");

        documents.Write(name, body);
        return ApiResponse.Json(200, new JsonObject
        {
            ["ok"] = true,
            ["bytes"] = body.Length,
            ["savedAt"] = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ"),
        });
    }

    private ApiResponse VaultFile(string method, string id, byte[] body)
    {
        switch (method)
        {
            case "GET":
            {
                DocumentRead read = vaultFiles.Read(id);
                return read.Status switch
                {
                    DocumentReadStatus.NotFound => ApiResponse.Error(404, "not-found", "That encrypted attachment does not exist."),
                    DocumentReadStatus.Corrupt => ApiResponse.Error(500, "corrupt", "That encrypted attachment envelope is damaged or too large."),
                    _ => ApiResponse.Raw(200, read.Data),
                };
            }
            case "PUT":
                vaultFiles.Create(id, body);
                return Ok();
            case "DELETE":
            {
                using JsonDocument request = JsonDocument.Parse(body);
                JsonElement input = request.RootElement;
                if (input.ValueKind != JsonValueKind.Object || input.EnumerateObject().Count() != 1 ||
                    !input.TryGetProperty("confirm", out JsonElement confirm) || confirm.ValueKind != JsonValueKind.True)
                    return ApiResponse.Error(400, "confirm-required", "Deleting an encrypted attachment requires {\"confirm\":true}.");
                vaultFiles.Delete(id);
                return Ok();
            }
            default:
                return ApiResponse.Error(405, "method", "Unsupported method.");
        }
    }

    private ApiResponse VpnState()
    {
        BrowserPolicy policy = BrowserPolicy.Load(documents);
        return ApiResponse.Json(200, new JsonObject
        {
            ["browserRunning"] = browser.BrowserRunning,
            ["enabled"] = policy.ProtectionRequested,
            ["active"] = policy.ProtectionActive,
            ["blocked"] = policy.Blocked,
            ["autoConnect"] = policy.AutoConnect,
            ["failClosed"] = policy.FailClosed,
            ["verifyUrl"] = policy.VerifyUrl,
            ["serverId"] = policy.ServerId,
            ["baselineIp"] = policy.BaselineIp,
            ["server"] = policy.Server is null ? null : ServerJson(policy.Server),
            ["servers"] = new JsonArray(policy.Servers.Select(ServerJson).ToArray()),
        });
    }

    private ApiResponse VpnApply(byte[] body)
    {
        if (body.Length > PathManager.MaxDocumentBytes)
            return ApiResponse.Error(413, "too-large", "That VPN configuration is larger than Surge allows.");

        JsonObject input = ParseObject(body);
        if (!RequireConfirm(input))
            return ApiResponse.Error(400, "confirm-required", "Applying VPN settings restarts Firefox and needs an explicit confirmation.");

        var servers = new JsonArray();
        foreach (JsonNode? node in input["servers"] as JsonArray ?? [])
        {
            if (node is not JsonObject item)
                continue;
            ProxyServer? parsed = BrowserPolicy.ParseServer(item);
            if (parsed is null)
                return ApiResponse.Error(400, "bad-proxy",
                    "Every server needs a valid host, a port between 1 and 65535, and a type of socks5 or https.");
            if (servers.Count >= 20)
                return ApiResponse.Error(400, "too-many-servers", "Surge stores at most 20 proxy servers.");
            servers.Add((JsonNode)ServerJson(parsed));
        }

        string? serverId = input["serverId"]?.GetValue<string>();
        bool enabled = Bool(input, "enabled", false);
        if (enabled && !servers.OfType<JsonObject>().Any(s => s["id"]?.GetValue<string>() == serverId))
            return ApiResponse.Error(400, "unknown-server", "Choose a valid proxy server before connecting.");

        var payload = new JsonObject
        {
            ["version"] = 1,
            ["enabled"] = enabled,
            ["serverId"] = serverId,
            ["autoConnect"] = Bool(input, "autoConnect", false),
            ["failClosed"] = Bool(input, "failClosed", true),
            ["verifyUrl"] = BrowserPolicy.NormalizeVerifyUrl(input["verifyUrl"]?.GetValue<string>()),
            ["baselineIp"] = BrowserPolicy.NormalizeIp(input["baselineIp"]?.GetValue<string>()),
            ["servers"] = servers,
        };

        documents.Write("vpn", Encoding.UTF8.GetBytes(payload.ToJsonString()));
        browser.RequestRestart();
        return ApiResponse.Json(200, new JsonObject { ["ok"] = true, ["restarting"] = browser.BrowserRunning });
    }

    private static JsonObject ServerJson(ProxyServer server) => new()
    {
        ["id"] = server.Id,
        ["name"] = server.Name,
        ["scheme"] = server.Scheme,
        ["host"] = server.Host,
        ["port"] = server.Port,
    };

    private static bool Bool(JsonObject input, string key, bool fallback) =>
        input[key] is JsonValue value && value.TryGetValue<bool>(out bool result) ? result : fallback;

    private ApiResponse FileAction(string action, byte[] body)
    {
        JsonObject input = ParseObject(body);
        string? requested = input["path"]?.GetValue<string>();

        switch (action)
        {
            case "mkdir":
            {
                string parent = ResolveOrdinaryPath(requested, allowRoot: true);
                string name = RequireString(input, "name");
                ResolveOrdinaryPath(paths.ToRelative(Path.Combine(parent, name)));
                files.MakeDirectory(parent, name);
                return Ok();
            }
            case "rename":
            {
                string source = ResolveOrdinaryPath(requested);
                string name = RequireString(input, "name");
                ResolveOrdinaryPath(paths.ToRelative(Path.Combine(Path.GetDirectoryName(source)!, name)));
                files.Rename(source, name);
                return Ok();
            }
            case "delete":
            {
                if (!RequireConfirm(input))
                    return ApiResponse.Error(400, "confirm-required", "Deleting requires an explicit confirmation.");
                string target = ResolveOrdinaryPath(requested);
                files.Delete(target);
                return Ok();
            }
            case "transfer":
            {
                if (!paths.TryResolve(requested, out string source, out string error))
                    return ApiResponse.Error(400, "bad-path", error);
                if (!paths.TryResolve(input["destination"]?.GetValue<string>(), out string destination, out string destError))
                    return ApiResponse.Error(400, "bad-path", destError);
                bool move = input["move"]?.GetValue<bool>() ?? false;
                if (move && !RequireConfirm(input))
                    return ApiResponse.Error(400, "confirm-required", "Moving requires an explicit confirmation.");
                files.Transfer(source, destination, move);
                return Ok();
            }
            case "open":
            {
                string target = ResolveOrdinaryPath(requested);
                files.Open(target);
                return Ok();
            }
            case "reveal":
            {
                string target = ResolveOrdinaryPath(requested);
                files.Reveal(target);
                return Ok();
            }
            default:
                return ApiResponse.Error(404, "not-found", "Unknown file operation.");
        }
    }

    private string ResolveOrdinaryPath(string? relative, bool allowRoot = false)
    {
        if (string.IsNullOrWhiteSpace(relative))
        {
            if (allowRoot)
                return paths.Root;
            throw new FileOperationException("A path is required.", 400);
        }

        if (!paths.TryResolve(relative, out string fullPath, out string error))
            throw new FileOperationException(error, 400);

        if (!allowRoot && fullPath.Equals(paths.Root, StringComparison.OrdinalIgnoreCase))
            throw new FileOperationException("The root folder cannot be modified.", 400);

        if (paths.IsSystemOrCodePath(fullPath))
            throw new FileOperationException("Access to system files is restricted.", 403);

        return fullPath;
    }

    private ApiResponse BiometricStatus()
    {
        try
        {
            var op = Windows.Security.Credentials.UI.UserConsentVerifier.CheckAvailabilityAsync();
            var avail = op.AsTask().GetAwaiter().GetResult();
            bool isAvailable = avail == Windows.Security.Credentials.UI.UserConsentVerifierAvailability.Available;
            return ApiResponse.Json(200, new JsonObject
            {
                ["available"] = isAvailable,
                ["status"] = avail.ToString(),
            });
        }
        catch (Exception ex)
        {
            return ApiResponse.Json(200, new JsonObject
            {
                ["available"] = false,
                ["status"] = ex.Message,
            });
        }
    }

    private ApiResponse BiometricVerify(byte[] body)
    {
        try
        {
            string message = "Scan your fingerprint to unlock Surge Vault";
            if (body.Length > 0)
            {
                try
                {
                    JsonObject? input = ParseObject(body);
                    if (input?["message"]?.GetValue<string>() is string customMsg && !string.IsNullOrWhiteSpace(customMsg))
                        message = customMsg;
                }
                catch { }
            }

            var op = Windows.Security.Credentials.UI.UserConsentVerifier.RequestVerificationAsync(message);
            var result = op.AsTask().GetAwaiter().GetResult();
            bool verified = result == Windows.Security.Credentials.UI.UserConsentVerificationResult.Verified;

            return ApiResponse.Json(200, new JsonObject
            {
                ["verified"] = verified,
                ["status"] = result.ToString(),
            });
        }
        catch (Exception ex)
        {
            return ApiResponse.Error(500, "biometric-error", ex.Message);
        }
    }

    private static ApiResponse Ok() => ApiResponse.Json(200, new JsonObject { ["ok"] = true });

    private static bool RequireConfirm(JsonObject input) => input["confirm"]?.GetValue<bool>() == true;

    private static string RequireString(JsonObject input, string key) =>
        input[key]?.GetValue<string>() ?? throw new InvalidDataException($"The request is missing '{key}'.");

    private static JsonObject ParseObject(byte[] body) =>
        JsonNode.Parse(body) as JsonObject ?? throw new InvalidDataException("The request body must be a JSON object.");

    private static string? QueryValue(string? query, string key)
    {
        if (string.IsNullOrEmpty(query))
            return null;
        foreach (string pair in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            int eq = pair.IndexOf('=');
            string name = eq < 0 ? pair : pair[..eq];
            if (!name.Equals(key, StringComparison.Ordinal))
                continue;
            string value = eq < 0 ? string.Empty : pair[(eq + 1)..];
            return Uri.UnescapeDataString(value.Replace('+', ' '));
        }
        return null;
    }
}
