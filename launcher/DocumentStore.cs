using System.Text.Json.Nodes;

namespace SurgePortable;

internal enum DocumentReadStatus { Ok, NotFound, Corrupt }

internal sealed record DocumentRead(DocumentReadStatus Status, byte[] Data, bool FromBackup);

/// JSON documents and the encrypted vault are written through a temporary file and replaced
/// atomically, keeping the previous good copy as a .bak. Vault payloads are ciphertext only.
internal sealed class DocumentStore(PathManager paths)
{
    private static readonly string[] Allowed = ["notes", "bookmarks", "settings", "vault"];

    public static bool IsAllowed(string name) => Allowed.Contains(name);

    public string PathFor(string name) => name switch
    {
        "notes" => Path.Combine(paths.NotesDir, "notes.json"),
        "bookmarks" => Path.Combine(paths.BookmarksDir, "bookmarks.json"),
        "settings" => Path.Combine(paths.SettingsDir, "settings.json"),
        "vault" => Path.Combine(paths.VaultDir, "vault.enc"),
        _ => throw new ArgumentException("Unknown document.", nameof(name)),
    };

    public DocumentRead Read(string name)
    {
        string target = PathFor(name);
        if (!File.Exists(target))
            return new DocumentRead(DocumentReadStatus.NotFound, [], false);

        byte[] data = File.ReadAllBytes(target);
        if (IsValidJson(data))
            return new DocumentRead(DocumentReadStatus.Ok, data, false);

        string backup = target + ".bak";
        if (File.Exists(backup))
        {
            byte[] fallback = File.ReadAllBytes(backup);
            if (IsValidJson(fallback))
                return new DocumentRead(DocumentReadStatus.Ok, fallback, true);
        }

        return new DocumentRead(DocumentReadStatus.Corrupt, [], false);
    }

    public void Write(string name, byte[] payload)
    {
        if (!IsValidJson(payload))
            throw new InvalidDataException("The submitted data is not a valid JSON object.");

        string target = PathFor(name);
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);

        string temp = target + ".tmp";
        try
        {
            using (var stream = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None, 64 * 1024, FileOptions.WriteThrough))
            {
                stream.Write(payload, 0, payload.Length);
                stream.Flush(flushToDisk: true);
            }

            if (File.Exists(target))
            {
                try
                {
                    File.Replace(temp, target, target + ".bak", ignoreMetadataErrors: true);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or PlatformNotSupportedException)
                {
                    File.Copy(target, target + ".bak", overwrite: true);
                    File.Move(temp, target, overwrite: true);
                }
            }
            else
            {
                File.Move(temp, target);
            }
        }
        finally
        {
            if (File.Exists(temp))
                File.Delete(temp);
        }
    }

    private static bool IsValidJson(byte[] data)
    {
        if (data.Length == 0)
            return false;
        try
        {
            return JsonNode.Parse(data) is JsonObject;
        }
        catch (Exception ex) when (ex is System.Text.Json.JsonException or ArgumentException)
        {
            return false;
        }
    }
}