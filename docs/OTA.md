# Surge Windows OTA updates

This document describes the first OTA implementation for the **installed Windows edition**.
The portable USB edition and bootable ISO are deliberately not updated by this mechanism.

## Release flow

1. Merge and test the Windows application changes.
2. Build the installer locally:

   ```powershell
   node packaging/desktop.cjs
   Compress-Archive -Path "build/desktop/Surge-win32-x64/*" -DestinationPath "build/app.zip" -CompressionLevel Optimal
   dotnet publish installer/SurgeInstaller.csproj -c Release -r win-x64 --self-contained true -p:Version=<version> -o build/installer
   ```

   This builds the Electron package, packs the .NET storage helper, and embeds both in
   `build/installer/Surge-Setup.exe`.

3. Create a GitHub Release with a tag such as `v1.1.0` (the older `v.1.0.0` form is also
   understood), attach `Surge-Setup.exe`, and publish it.

   GitHub Actions is not used: the repository's workflows were removed because Actions is
   locked on this account for a billing problem. Releases are built and attached by hand.

4. Installed Surge clients query the latest stable GitHub Release. If its version is newer,
   they offer the user an update.
5. After approval, Surge downloads the installer and checks the SHA-256 digest exposed by
   GitHub's Release Assets API. It then launches the installer with the existing installation
   directory preselected.

The `published` release event is intentional: draft releases do not reach clients.

## Why this does not use electron-updater

Surge currently uses `@electron/packager`, a custom .NET 10 installer, and an embedded
`build/app.zip`. It is not currently an electron-builder/NSIS application. The first updater
therefore reuses the existing installer instead of changing the packaging technology.

## Data safety

The installed Electron app stores its workspace under Windows AppData, separate from the
program installation directory. The update replaces the program payload only. It must not
remove or rewrite the user's vault, browser profile, notes, settings, or downloads.

The installer supports an update-directory argument so the update is applied to the directory
from which the running Surge executable was launched, including non-default install locations.

## Integrity and trust

The updater requires GitHub to expose a SHA-256 digest for the release installer and refuses
to download an asset without one. It verifies the actual downloaded bytes before launching
the installer. HTTPS and GitHub's release metadata are still part of the trust boundary; this
first iteration is **integrity checking, not independent publisher authentication**.

Before broad public rollout, add Windows Authenticode signing and a separately signed update
manifest with a public verification key embedded in Surge. Never store a signing private key
in the repository or in the installed application.

## First deployment

The existing v.1.0.0 release was published before this workflow existed, so it will not
retroactively trigger the workflow. Publish a new version (for example v1.0.1) after merging
this implementation to test the end-to-end release pipeline.

## Scope

- Installed Windows edition only.
- Stable releases only; drafts and prereleases are ignored.
- User approval required before downloading/installing.
- No silent background installation.
- No update checks for unpackaged development builds or portable mode.
- The ISO remains a separate release asset and is not modified by this workflow.
