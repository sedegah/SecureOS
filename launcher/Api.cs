using System.Text;
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
}

/// The workspace API. The browser never touches the filesystem directly; it asks this local helper.
internal sealed class Api(PathManager paths, DocumentStore documents, FileOperations files)
{
    public const string Version = "1.0.0";

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

            if (path == "/api/files" && method == "GET")
            {
                if (!paths.TryResolve(QueryValue(query, "path"), out string dir, out string error))
                    return ApiResponse.Error(400, "bad-path", error);
                return ApiResponse.Json(200, files.List(dir));
            }

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
            ["app"] = "Surge Portable",
            ["version"] = Version,
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

    private ApiResponse FileAction(string action, byte[] body)
    {
        JsonObject input = ParseObject(body);
        string? requested = input["path"]?.GetValue<string>();

        switch (action)
        {
            case "mkdir":
            {
                if (!paths.TryResolve(requested, out string parent, out string error))
                    return ApiResponse.Error(400, "bad-path", error);
                files.MakeDirectory(parent, RequireString(input, "name"));
                return Ok();
            }
            case "rename":
            {
                if (!paths.TryResolve(requested, out string source, out string error))
                    return ApiResponse.Error(400, "bad-path", error);
                files.Rename(source, RequireString(input, "name"));
                return Ok();
            }
            case "delete":
            {
                if (!RequireConfirm(input))
                    return ApiResponse.Error(400, "confirm-required", "Deleting requires an explicit confirmation.");
                if (!paths.TryResolve(requested, out string target, out string error))
                    return ApiResponse.Error(400, "bad-path", error);
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
                if (!paths.TryResolve(requested, out string target, out string error))
                    return ApiResponse.Error(400, "bad-path", error);
                files.Open(target);
                return Ok();
            }
            case "reveal":
            {
                if (!paths.TryResolve(requested, out string target, out string error))
                    return ApiResponse.Error(400, "bad-path", error);
                files.Reveal(target);
                return Ok();
            }
            default:
                return ApiResponse.Error(404, "not-found", "Unknown file operation.");
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