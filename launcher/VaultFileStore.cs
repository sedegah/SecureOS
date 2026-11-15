using System.Text.Json;

namespace SurgePortable;

internal sealed class VaultFileStore(PathManager paths)
{
    public const int MaxPlaintextBytes = 16 * 1024 * 1024;
    public const int MaxEnvelopeBytes = 23 * 1024 * 1024;
    private const string DirectoryRelative = "Data/PasswordVault/Files";

    public static bool IsValidId(string id) =>
        Guid.TryParseExact(id, "D", out Guid parsed) && parsed.ToString("D") == id;

    public DocumentRead Read(string id)
    {
        string target = Resolve(FileRelative(id));
        try
        {
            using var stream = new FileStream(target, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (stream.Length > MaxEnvelopeBytes)
                return new DocumentRead(DocumentReadStatus.Corrupt, [], false);
            byte[] data = new byte[(int)stream.Length];
            stream.ReadExactly(data);
            try
            {
                ValidateEnvelope(data);
                return new DocumentRead(DocumentReadStatus.Ok, data, false);
            }
            catch (Exception ex) when (ex is InvalidDataException or FileOperationException)
            {
                return new DocumentRead(DocumentReadStatus.Corrupt, [], false);
            }
        }
        catch (Exception ex) when (ex is FileNotFoundException or DirectoryNotFoundException)
        {
            return new DocumentRead(DocumentReadStatus.NotFound, [], false);
        }
        catch (EndOfStreamException)
        {
            return new DocumentRead(DocumentReadStatus.Corrupt, [], false);
        }
    }

    public void Create(string id, byte[] payload)
    {
        ValidateEnvelope(payload);
        RequireUsb();
        string relative = FileRelative(id);
        string target = Resolve(relative);
        if (File.Exists(target) || Directory.Exists(target))
            throw Conflict();

        string directory = Resolve(DirectoryRelative);

        if (!Directory.Exists(Path.GetDirectoryName(directory)))
            throw new DirectoryNotFoundException("The vault folder is no longer available on the USB drive.");
        RequireUsb();
        Directory.CreateDirectory(directory);

        string tempRelative = DirectoryRelative + "/" + id + "." + Guid.NewGuid().ToString("N") + ".tmp";
        string temp = Resolve(tempRelative);
        bool created = false;
        try
        {
            RequireUsb();
            using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                64 * 1024, FileOptions.WriteThrough))
            {
                created = true;
                stream.Write(payload);
                stream.Flush(flushToDisk: true);
            }

            RequireUsb();

            temp = Resolve(tempRelative);
            target = Resolve(relative);
            try
            {
                File.Move(temp, target, overwrite: false);
            }
            catch (IOException) when (File.Exists(target) || Directory.Exists(target))
            {
                throw Conflict();
            }
        }
        finally
        {

            try
            {
                if (created && paths.UsbPresent && paths.TryResolve(tempRelative, out string cleanup, out _))
                    File.Delete(cleanup);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {

            }
        }
    }

    public void Delete(string id)
    {
        RequireUsb();
        string target = Resolve(FileRelative(id));
        if (!File.Exists(target))
            throw new FileOperationException("That encrypted attachment no longer exists.", 404);
        RequireUsb();
        File.Delete(target);
    }

    private string Resolve(string relative)
    {
        if (!paths.TryResolve(relative, out string target, out string error))
            throw new FileOperationException(error);
        return target;
    }

    private static string FileRelative(string id)
    {
        if (!IsValidId(id))
            throw new InvalidDataException("An attachment ID must be a canonical lowercase UUID.");
        return DirectoryRelative + "/" + id + ".enc";
    }

    private void RequireUsb()
    {
        if (!paths.UsbPresent)
            throw new FileOperationException("The Surge USB drive is no longer available. No files were written to this computer.", 503);
    }

    private static FileOperationException Conflict() =>
        new("An encrypted attachment with that ID already exists.", 409);

    private static void ValidateEnvelope(byte[] payload)
    {
        if (payload.Length > MaxEnvelopeBytes)
            throw new FileOperationException("That encrypted attachment envelope is too large.", 413);
        try
        {
            using JsonDocument document = JsonDocument.Parse(payload, new JsonDocumentOptions { MaxDepth = 8 });
            JsonElement root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
                throw BadEnvelope();
            var fields = new HashSet<string>(StringComparer.Ordinal);
            foreach (JsonProperty field in root.EnumerateObject())
            {
                if (field.Name is not ("version" or "cipher" or "iv" or "ciphertext") || !fields.Add(field.Name))
                    throw BadEnvelope();
            }
            if (fields.Count != 4 || root.GetProperty("version").ValueKind != JsonValueKind.Number ||
                !root.GetProperty("version").TryGetInt32(out int version) || version != 1 ||
                root.GetProperty("cipher").ValueKind != JsonValueKind.String ||
                root.GetProperty("cipher").GetString() != "AES-256-GCM")
                throw BadEnvelope();

            ValidateBase64(root.GetProperty("iv"), 12, 12);

            ValidateBase64(root.GetProperty("ciphertext"), 16, MaxPlaintextBytes + 16);
        }
        catch (JsonException)
        {
            throw BadEnvelope();
        }
    }

    private static void ValidateBase64(JsonElement element, int minimum, int maximum)
    {
        if (element.ValueKind != JsonValueKind.String)
            throw BadEnvelope();
        string value = element.GetString()!;
        if (value.Length > 4 * ((maximum + 2) / 3))
            throw new FileOperationException("That encrypted attachment field is too large.", 413);
        if (value.Length == 0 || value.Length % 4 != 0)
            throw BadEnvelope();

        int padding = value.EndsWith("==", StringComparison.Ordinal) ? 2 : value.EndsWith('=') ? 1 : 0;
        int last = 0;
        for (int i = 0; i < value.Length - padding; i++)
        {
            char c = value[i];
            last = c switch
            {
                >= 'A' and <= 'Z' => c - 'A',
                >= 'a' and <= 'z' => c - 'a' + 26,
                >= '0' and <= '9' => c - '0' + 52,
                '+' => 62,
                '/' => 63,
                _ => -1,
            };
            if (last < 0)
                throw BadEnvelope();
        }

        if ((padding == 2 && (last & 15) != 0) || (padding == 1 && (last & 3) != 0))
            throw BadEnvelope();
        int length = value.Length / 4 * 3 - padding;
        if (length > maximum)
            throw new FileOperationException("That encrypted attachment field is too large.", 413);
        if (length < minimum)
            throw BadEnvelope();
    }

    private static InvalidDataException BadEnvelope() =>
        new("Expected only version 1, cipher AES-256-GCM, a 12-byte Base64 IV and Base64 ciphertext including a 16-byte tag.");
}

