# Surge Portable — architecture and build notes

## 1. Components

```
16GB SURGE USB
├── Surge.exe            launcher + loopback workspace helper (C# / .NET, self-contained)
├── Browser/             Firefox runtime
├── Interface/           Surge homepage (HTML + CSS + vanilla JS)
├── Data/                profile, notes, bookmarks, settings, encrypted vault
└── Downloads/           everything Firefox downloads
```

### Surge.exe

1. Resolves its own directory at runtime (`Environment.ProcessPath`) — no drive letter is
   ever hardcoded, so the drive can move between `E:`, `F:`, `G:` freely.
2. Validates that `Interface/index.html` and a Firefox runtime exist; shows a plain-language
   Windows message box and stops if something is missing or damaged.
3. Creates missing data directories **inside the USB folder only**.
4. Takes a per-drive named mutex so a second double-click cannot start a second instance.
5. Starts the workspace helper on `127.0.0.1` with a random free port and a random
   48-character session token, then launches Firefox with the USB profile and the homepage URL.
6. Stays resident only while Firefox is running, because native USB file operations genuinely
   need it. When Firefox exits, the helper exits too. Nothing is left running when idle.

### Why a local helper at all

A normal webpage cannot read arbitrary USB files, open them with their Windows default
application, or query free disk space. Rather than weakening browser security, Surge serves
the workspace from a loopback-only helper that performs those native operations behind a
small JSON API. The browser sandbox stays intact.

Serving over `http://127.0.0.1:<port>` (instead of `file://`) also gives the page a secure
context, which WebCrypto requires for AES-GCM, and avoids `file://` origin restrictions.

### Firefox

`package.ps1` places the Firefox runtime at `Browser/FirefoxPortable/App/Firefox64/firefox.exe`.
Surge launches that runtime directly:

```
firefox.exe -no-remote -profile <USB>\Data\Profile <homepage URL>
```

This works with both the official Mozilla build and the payload of a PortableApps
`FirefoxPortable` distribution. The PortableApps `FirefoxPortable.exe` stub is intentionally
not used: it forces its own profile location, which would move the profile out of
`Data/Profile`. Launching the runtime directly keeps the profile, history, cookies and
preferences exactly where the specification puts them, on the USB.

On every launch Surge regenerates `Data/Profile/user.js` with runtime-resolved paths and
portable preferences:

- downloads go to `<USB>\Downloads`, never to a host temp folder
  (`browser.download.start_downloads_in_tmp_dir = false`)
- Firefox's own password saving is disabled (`signon.rememberSignons = false`) so there are
  not two competing password stores
- automatic browser updates are disabled (`app.update.auto = false`) — never update while running
- Firefox Accounts / Sync is disabled, telemetry and data submission are off
- disk cache is disabled (memory cache only) to reduce USB writes and host residue
- session store writes are throttled to 60s to reduce USB wear
- first-run/welcome/whats-new pages are suppressed so the workspace is the first thing seen

`user.js` is Surge-managed and overwritten each launch; user preferences belong in
`Data/Settings/settings.json`.

## 2. Workspace API

All `/api/*` requests must carry the launch token in `X-Surge-Token`. The helper also
rejects a foreign `Host`, a foreign `Origin`, and any `Sec-Fetch-Site` other than
`same-origin`/`none`, so a website you visit cannot drive the helper.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/status` | version, USB root, storage totals, low/critical flags |
| `GET /api/heartbeat` | keep-alive and USB presence poll (every 20s) |
| `GET/PUT /api/doc/{notes,bookmarks,settings}` | workspace documents, atomic writes |
| `GET/PUT /api/vault` | encrypted vault envelope only |
| `GET /api/files?path=` | folder listing (name, type, size, modified) |
| `POST /api/files/mkdir|rename|delete|transfer|open|reveal` | native file operations |

Writes are atomic: payload → `*.tmp` (flushed to disk) → `File.Replace` over the target with
the previous good copy kept as `*.bak`. On filesystems where `ReplaceFile` is unavailable
(exFAT can refuse it) the helper falls back to copy-then-move. Reads validate JSON and
automatically fall back to `.bak`, reporting `X-Surge-Source: backup` so the UI can tell the
user. The vault is only ever written as ciphertext — never to a plaintext temporary file.

Every path is resolved against the USB root and rejected if it is absolute, contains `..`,
contains a drive colon, or crosses a reparse point. `Surge.exe`, `Browser`, `Interface` and
`README.txt` cannot be renamed, moved or deleted through the file manager. Deletes and moves
require an explicit `confirm: true` in addition to the UI confirmation dialog.

If the USB disappears, every mutating endpoint answers `503 usb-missing`, the UI shows a
banner and pauses operations, and **no replacement folders are created on the host**.

## 3. Data layout

```
Data/Notes/notes.json            { version, notes: [{id,title,body,createdAt,modifiedAt}] }
Data/Bookmarks/bookmarks.json    { version, folders: [...], items: [...] }
Data/Settings/settings.json      { version, theme, searchEngine, vaultLockMinutes, clipboardClearSeconds }
Data/PasswordVault/vault.enc     { version, kdf{argon2id,salt,params}, cipher, iv, ciphertext, timestamps }
Data/Profile/                    Firefox profile (user.js regenerated each launch)
```

## 4. Bookmarks and Firefox

Firefox's native bookmark database stays the browser's source of truth. Surge keeps its own
panel for the homepage and **never opens `places.sqlite` while Firefox is running**. The two
are bridged by import/export:

- *Export for Firefox* writes a Netscape bookmark HTML file that Firefox imports natively.
- *Import* accepts that same HTML format (e.g. exported from Firefox) or a Surge JSON export.
- Duplicate URLs are skipped on import; folders are preserved.

## 5. Build and package

```powershell
packaging\build.ps1                 # dotnet publish -> build\publish\Surge.exe
packaging\package.ps1 -DownloadBrowser   # assemble build\SURGE (fetch Firefox from Mozilla)
packaging\package.ps1 -BrowserSource <path>  # use an existing Firefox folder/MSI/installer
packaging\package.ps1 -SkipBrowser  # interface-only package (Surge reports the missing browser)
packaging\verify.ps1                # layout, budgets, live smoke test
```

The launcher is published self-contained, single-file, trimmed, win-x64, so the host needs
no .NET installation. Measured: **Surge.exe ≈ 10.6MB** (target < 20MB), **Interface ≈ 0.14MB**
(target < 5MB), Firefox runtime ≈ 0.35GB, total package ≈ 0.36GB against the 14.5GB usable
planning assumption for a 16GB drive.

Filesystem: exFAT is recommended for a 16GB drive. FAT32 works but cannot hold a single file
larger than 4GB.

## 6. Tests

- `tests/vault-crypto.test.mjs` — Argon2id + AES-GCM round trip, wrong master password,
  tampered ciphertext, downgraded KDF parameters, truncated vault, fresh IV per save,
  unique salt per vault.
- `tests/api.test.mjs` — spawns the real `Surge.exe` against a temporary USB folder and
  checks status/storage, token enforcement, cross-site/Origin/Host rejection, static
  traversal, document round trips, backup recovery, vault ciphertext storage, full file
  manager lifecycle, confirmation requirements, conflict handling, path confinement,
  protected entries, size limits, USB removal, and persistence across a helper restart.
- `packaging/verify.ps1` — packaged layout, size budgets, no hardcoded drive paths, and a
  live helper smoke test.

Acceptance criteria from the specification map to these tests plus the manual checks in
`USER_GUIDE.md` (clean Windows 10/11 machine, different drive letters, real USB removal).

## 7. Known limitations in 1.0

- The master password cannot be changed yet; create a new vault and re-enter entries, or
  restore from your own backup. (Changing it is a planned 1.1 item.)
- Clipboard clearing is best-effort: it needs the workspace tab to stay open, and it clears
  whatever is on the clipboard when the timer fires.
- Notes, bookmarks and settings are stored as plaintext JSON on the USB. Only the vault is
  encrypted. Anyone who can read the drive can read those files.
- No extensions are bundled; install what you need from Firefox's Add-ons manager (uBlock
  Origin is a sensible first choice). Extensions live in the USB profile.
- Surge cannot detect an *intent* to remove the drive; it detects that the drive is gone.