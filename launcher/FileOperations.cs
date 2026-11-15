using System.Diagnostics;
using System.Text.Json.Nodes;

namespace SurgePortable;

internal sealed class FileOperationException(string message, int status = 400) : Exception(message)
{
    public int Status { get; } = status;
}

internal sealed class FileOperations(PathManager paths)
{
    private const int MaxEntries = 5000;
    private static readonly char[] InvalidNameChars = [.. Path.GetInvalidFileNameChars(), '/', '\\'];

    public JsonObject List(string directory)
    {
        if (!Directory.Exists(directory))
            throw new FileOperationException("That folder no longer exists on the USB drive.", 404);

        if (paths.IsSystemOrCodePath(directory))
            throw new FileOperationException("Access to system files is restricted.", 403);

        var entries = new JsonArray();
        var dirs = new DirectoryInfo(directory).EnumerateDirectories()
            .Where(d => !d.Attributes.HasFlag(FileAttributes.ReparsePoint) && !paths.IsSystemOrCodeItem(d.Name, isDirectory: true))
            .OrderBy(d => d.Name, StringComparer.OrdinalIgnoreCase);
        var files = new DirectoryInfo(directory).EnumerateFiles()
            .Where(f => !paths.IsSystemOrCodeItem(f.Name, isDirectory: false))
            .OrderBy(f => f.Name, StringComparer.OrdinalIgnoreCase);

        int count = 0;
        bool truncated = false;
        foreach (FileSystemInfo info in dirs.Cast<FileSystemInfo>().Concat(files))
        {
            if (count++ >= MaxEntries)
            {
                truncated = true;
                break;
            }

            bool isDir = info is DirectoryInfo;
            entries.Add((JsonNode)new JsonObject
            {
                ["name"] = info.Name,
                ["type"] = isDir ? "dir" : "file",
                ["size"] = isDir ? 0 : ((FileInfo)info).Length,
                ["modified"] = info.LastWriteTimeUtc.ToString("yyyy-MM-ddTHH:mm:ssZ"),
                ["extension"] = isDir ? string.Empty : info.Extension.TrimStart('.').ToLowerInvariant(),
            });
        }

        string? parent = Path.GetDirectoryName(directory);
        return new JsonObject
        {
            ["path"] = paths.ToRelative(directory),
            ["parent"] = parent is null || !parent.StartsWith(paths.Root, StringComparison.OrdinalIgnoreCase)
                ? null
                : paths.ToRelative(parent),
            ["isRoot"] = directory.Equals(paths.Root, StringComparison.OrdinalIgnoreCase),
            ["entries"] = entries,
            ["truncated"] = truncated,
        };
    }

    public void MakeDirectory(string parent, string name)
    {
        ValidateName(name);
        if (paths.IsSystemOrCodeItem(name, isDirectory: true))
            throw new FileOperationException("That folder name is reserved by the system.", 403);
        string target = Path.Combine(parent, name);
        if (Directory.Exists(target) || File.Exists(target))
            throw new FileOperationException("A file or folder with that name already exists.", 409);
        Directory.CreateDirectory(target);
    }

    public void Rename(string source, string newName)
    {
        RequireExists(source);
        GuardProtected(source);
        ValidateName(newName);
        if (paths.IsSystemOrCodeItem(newName, isDirectory: Directory.Exists(source)))
            throw new FileOperationException("That name is reserved by the system.", 403);

        string target = Path.Combine(Path.GetDirectoryName(source)!, newName);
        if (Directory.Exists(target) || File.Exists(target))
            throw new FileOperationException("A file or folder with that name already exists.", 409);

        if (Directory.Exists(source))
            Directory.Move(source, target);
        else
            File.Move(source, target);
    }

    public void Delete(string target)
    {
        RequireExists(target);
        GuardProtected(target);
        if (Directory.Exists(target))
            Directory.Delete(target, recursive: true);
        else
            File.Delete(target);
    }

    public void Transfer(string source, string destinationDirectory, bool move)
    {
        RequireExists(source);
        if (move)
            GuardProtected(source);
        if (!Directory.Exists(destinationDirectory))
            throw new FileOperationException("The destination folder does not exist.", 404);

        string destination = Path.Combine(destinationDirectory, Path.GetFileName(source));
        if (File.Exists(destination) || Directory.Exists(destination))
            throw new FileOperationException("A file or folder with that name already exists in the destination.", 409);

        bool isDir = Directory.Exists(source);
        if (isDir)
        {
            string fullDest = Path.GetFullPath(destination);
            if (fullDest.StartsWith(source + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new FileOperationException("A folder cannot be copied into itself.");
        }

        if (move)
        {
            if (isDir) Directory.Move(source, destination);
            else File.Move(source, destination);
            return;
        }

        if (isDir) CopyDirectory(source, destination);
        else File.Copy(source, destination);
    }

    public void Open(string target)
    {
        RequireExists(target);
        GuardProtected(target);
        Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
    }

    public void Reveal(string target)
    {
        RequireExists(target);
        GuardProtected(target);
        Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{target}\"") { UseShellExecute = true });
    }

    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (string file in Directory.GetFiles(source))
            File.Copy(file, Path.Combine(destination, Path.GetFileName(file)));
        foreach (string dir in Directory.GetDirectories(source))
        {
            if (new DirectoryInfo(dir).Attributes.HasFlag(FileAttributes.ReparsePoint))
                continue;
            CopyDirectory(dir, Path.Combine(destination, Path.GetFileName(dir)));
        }
    }

    private void GuardProtected(string target)
    {
        if (paths.IsProtected(target) || paths.IsSystemOrCodePath(target))
            throw new FileOperationException("That item is part of Surge itself and cannot be changed here.", 403);
    }

    private static void RequireExists(string target)
    {
        if (!File.Exists(target) && !Directory.Exists(target))
            throw new FileOperationException("That item no longer exists on the USB drive.", 404);
    }

    private static void ValidateName(string name)
    {
        if (string.IsNullOrWhiteSpace(name) || name is "." or ".." || name.IndexOfAny(InvalidNameChars) >= 0)
            throw new FileOperationException("That name contains characters Windows does not allow.");
        if (name.Length > 200)
            throw new FileOperationException("That name is too long.");
    }
}
