# Surge Portable 1.0

A lightweight, self-contained browser workspace that runs from a 16GB USB flash drive on
Windows 10/11 (64-bit). Insert the drive, double-click `Surge.exe`, and Firefox opens with
the Surge workspace as its homepage. No installation, no administrator rights, no cloud
account, no background service left running afterwards.

**The browser and your personal workspace travel together on the USB.**

## Features

| Feature | What it does |
| --- | --- |
| Browser | Firefox with its profile, history and cookies stored on the USB |
| Files | USB file manager: browse, open, create, rename, copy, move, delete |
| Notes | Offline notes with autosave, search and a Markdown preview |
| Bookmarks | Surge shortcut panel with folders, search and Firefox-compatible import/export |
| Downloads | Every Firefox download lands in `SURGE/Downloads`, listed in the workspace |
| Passwords | Local vault encrypted with Argon2id + AES-256-GCM, auto-lock, clipboard clearing |
| Settings | Theme, search engine, vault timeout, clipboard timeout — stored on the USB |

## Quick start (build a drive)

Requires the .NET 10 SDK, PowerShell, and 7-Zip (only to unpack Firefox).

```powershell
# 1. Build the launcher and assemble a complete SURGE folder, downloading Firefox from Mozilla
powershell -NoProfile -ExecutionPolicy Bypass -File packaging\package.ps1 -DownloadBrowser

# 2. Verify the package (layout, size budgets, live helper smoke test)
powershell -NoProfile -ExecutionPolicy Bypass -File packaging\verify.ps1

# 3. Copy build\SURGE to the root of the USB drive, then run Surge.exe from there
```

Already have Firefox? Point the packager at it instead of downloading:

```powershell
packaging\package.ps1 -BrowserSource "D:\Downloads\FirefoxPortable"      # folder
packaging\package.ps1 -BrowserSource "D:\Downloads\Firefox Setup 145.exe" # installer
packaging\package.ps1 -BrowserSource "D:\Downloads\firefox.msi"           # MSI
```

## Tests

```powershell
node tests\vault-crypto.test.mjs   # Argon2id/AES-GCM: round trip, wrong password, tampering
node tests\api.test.mjs            # live helper: auth, path confinement, CRUD, backups, restart
packaging\verify.ps1               # packaged layout + smoke test
```

## Repository layout

```
launcher/    C# launcher and loopback workspace helper (published as Surge.exe)
interface/   Surge homepage: HTML, CSS, vanilla JS modules, vendored Argon2 bundle
packaging/   build.ps1, package.ps1, verify.ps1
tests/       crypto and helper integration tests
docs/        README, SECURITY, USER_GUIDE
LICENSES/    third-party license texts
```

The packaged Firefox runtime is deliberately **not** committed; `package.ps1` fetches it.

## Documentation

- [docs/README.md](docs/README.md) — architecture, design decisions, build details
- [docs/SECURITY.md](docs/SECURITY.md) — threat model, cryptography, hardening, limitations
- [docs/USER_GUIDE.md](docs/USER_GUIDE.md) — day-to-day use and troubleshooting

## Status

Version 1.0 scope is implemented: launcher, homepage, files, notes, bookmarks, downloads,
encrypted vault, settings, packaging and tests. Excluded by design: cloud sync, email
client, AI assistant, app store, custom browser engine, desktop environment, autorun on
insertion, VPN/anonymity guarantees.

Surge is not a zero-trace tool. Windows, antivirus software and websites can still leave
traces on the host computer.