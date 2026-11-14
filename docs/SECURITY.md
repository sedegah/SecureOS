# Surge Portable — security notes

This document describes what Surge protects, how, and where the limits are. It is written
for someone reviewing the design, not for day-to-day use; see the
[user guide](USER_GUIDE.md) for that.

## 1. What Surge is defending against

| Threat | Position |
| --- | --- |
| Someone who finds or steals the USB drive | Vault contents are encrypted; notes, bookmarks and files are not |
| Another user of the same computer reading Surge data | Data stays on the drive; the vault is locked at startup |
| A malicious website reaching Surge's local helper | Blocked by token, Origin, Host and fetch-metadata checks |
| Another local process reaching the helper | Must guess a per-launch 256-bit-equivalent token |
| Losing data to a crash or unsafe removal | Atomic writes with a rolling backup |
| A compromised or curious host computer | **Not defended.** See limitations |
| Network surveillance or deanonymisation | **Not defended.** Surge is not an anonymity tool |

## 2. Password vault

### Key derivation and encryption

- **Argon2id** with memory 65536 KiB (64 MiB), 3 iterations, parallelism 1, a 16-byte
  random salt generated per vault, and a 32-byte output key.
- **AES-256-GCM** via the browser's WebCrypto implementation, with a fresh 12-byte random
  IV per encryption and a 128-bit authentication tag.
- The derived key is imported as a **non-extractable** `CryptoKey`; the raw key bytes are
  zeroed immediately after import.
- Argon2id comes from a vendored copy of `hash-wasm` 4.13.0 (MIT). It is bundled on the
  drive, so no network access is needed at any point.

### Parameter binding

The KDF parameters are authenticated, not just stored. The AES-GCM additional
authenticated data is:

```
surge-vault-v1|argon2id|<memoryKiB>|<iterations>|<parallelism>|<salt>
```

An attacker who edits the envelope to weaken the KDF — dropping memory cost or iterations
to make offline guessing cheaper — causes authentication to fail. The vault refuses to
open rather than silently accepting weaker parameters. Envelope validation additionally
bounds memory to 8192–1048576 KiB, iterations to 1–10 and parallelism to 1–16.

### What is stored

`Data/PasswordVault/vault.enc` holds a JSON envelope containing only the salt, KDF
parameters, IV and ciphertext. There is no plaintext entry, no password hint, no key
material and no master-password verifier anywhere on the drive.

The master password exists only in page memory while the vault is unlocked. It is never
sent to the helper, never written to disk, and never logged.

### Locking

- The vault starts locked on every launch.
- It locks automatically after a configurable period with no pointer, key or wheel
  activity, and on a manual **Lock** action.
- Locking discards the key, the decrypted entries and any revealed passwords, and clears
  the clipboard if Surge had copied a password into it.
- Copied passwords are cleared from the clipboard after a short configurable timeout.

Clipboard clearing is best-effort. Windows clipboard history, third-party clipboard
managers and remote-desktop clipboard redirection can retain a copy that Surge cannot
reach.

### Wrong passwords and damage

Any decryption or parse failure is reported identically as a wrong password, so the
response does not distinguish a bad password from a tampered file. If the envelope itself
is structurally invalid, the UI shows a distinct "damaged" state and **refuses to
overwrite it**, to avoid destroying a recoverable vault.

### No recovery

There is deliberately no recovery mechanism. A forgotten master password means the vault
is permanently unreadable. The creation flow states this explicitly and requires the user
to acknowledge it.

## 3. The local helper

A normal webpage cannot read USB files, and Surge does not weaken browser security to get
around that. Instead the launcher runs a small HTTP helper on loopback and the homepage
talks to it.

### Transport

- A raw `TcpListener` bound to `127.0.0.1` only. It is not reachable from the network.
- Deliberately **not** `HttpListener`/http.sys, which would require administrator rights
  or a URL ACL reservation. Surge needs neither.
- Serving over `http://127.0.0.1` gives the page a **secure context**, which WebCrypto
  requires. A `file://` homepage would not.
- `Connection: close` on every response, a 16 KB header cap, a 33 MB body cap and a
  16-request concurrency limit.

### Request authentication

Every launch generates a fresh token from 24 random bytes (48 hex characters). It is
handed to the page in the URL **fragment** (`#k=…`), which browsers do not send to servers
or include in `Referer`, and the page moves it into `sessionStorage` and strips the hash.
API calls present it in `X-Surge-Token`, compared in constant time.

A request is rejected unless all of the following hold:

| Check | Purpose |
| --- | --- |
| `Host` is `127.0.0.1` or `localhost` with the expected port | Blocks DNS-rebinding |
| `Origin`, when present, equals the helper's own origin | Blocks other origins |
| `Sec-Fetch-Site` is `same-origin` or `none` | Blocks cross-site requests |
| `X-Surge-Token` matches for `/api/*` | Blocks unauthorised callers |

Static responses carry a Content-Security-Policy (`script-src 'self'
'wasm-unsafe-eval'`, `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff` and
`Cache-Control: no-store`.

### Path confinement

All file paths are workspace-relative. The resolver rejects absolute paths, drive
colons, leading separators, any `..` component, anything that resolves outside the Surge
folder, and reparse points (symlinks and junctions), so a link cannot be used to reach
the host filesystem.

`Surge.exe`, `Browser`, `Interface` and `README.txt` are protected: the file manager will
not rename, move or delete them. Delete and move additionally require an explicit
`confirm: true` from the UI, which is only sent after the user accepts a dialog.

### Lifetime

The helper runs only while Firefox is open and exits shortly after the browser closes.
Nothing is left running in the background, and nothing is installed or registered to start
automatically.

## 4. Browser configuration

Firefox is launched directly with `-no-remote -profile <USB>\Data\Profile`, so the profile,
history, cookies and cache location are on the drive rather than in the host user's
`%APPDATA%`.

A `user.js` is regenerated on each launch. Security-relevant settings:

| Preference | Reason |
| --- | --- |
| `signon.rememberSignons=false` | Avoids a second, competing password store |
| `identity.fxaccounts.enabled=false` | No cloud account or sync |
| `app.update.auto=false` | The browser is never updated while running |
| `browser.download.dir` → USB, `start_downloads_in_tmp_dir=false` | Downloads never land in the host temp folder |
| Telemetry and data-reporting prefs off | No usage data leaves the drive |
| `browser.cache.disk.enable=false` | Avoids a host-side disk cache |
| `browser.sessionstore.interval=60000` | Fewer writes to the flash drive |

`MOZ_CRASHREPORTER_DISABLE=1` is set so crash dumps are not submitted.

Surge does **not** read or modify Firefox's saved-password files, and does **not** write to
`places.sqlite` while Firefox is running. Bookmarks move between Surge and Firefox only
through explicit Netscape-HTML or JSON import/export.

## 5. Data integrity

- JSON documents are written to a `*.tmp` file opened with `WriteThrough` and flushed to
  disk, then swapped in with `File.Replace`, keeping the previous version as `*.bak`.
- On filesystems where `File.Replace` is unsupported (some exFAT configurations), Surge
  falls back to copy-then-move and still produces a backup.
- On read, a corrupt or truncated document is recovered from `.bak` and the response is
  marked `X-Surge-Source: backup` so the UI can tell the user.
- The vault is only ever written as ciphertext. There is no plaintext temporary file at
  any point.
- Leftover `.tmp` files are cleaned up.

## 6. USB removal

Every mutating request first checks that the drive is still present. If it is not, the
helper returns `503 usb-missing` and writes nothing. It never creates replacement folders
on the host. The UI shows a persistent banner asking the user to reconnect the drive.

## 7. Limitations — read this before trusting Surge

- **Notes, bookmarks, settings and files are not encrypted.** Anyone with the drive can
  read them. Only the vault is encrypted. Do not put secrets in Notes.
- **The host computer is trusted.** Surge cannot defend against a keylogger, a memory
  scraper, malware or an administrator on the machine you plug into. An unlocked vault is
  decrypted in that machine's memory.
- **Surge is not zero-trace.** Windows prefetch, registry artefacts, antivirus scans,
  thumbnail caches, pagefile contents and network logs can all record that Surge ran.
  Nothing here is designed to defeat forensic examination.
- **Surge is not an anonymity tool.** There is no VPN, proxy or Tor integration. Your
  ISP and the sites you visit see your traffic normally.
- **No vault recovery.** By design.
- **Clipboard clearing is best-effort**, as described above.
- **Firefox updates are manual.** Auto-update is disabled to avoid updating a running
  browser or overwriting a profile. Re-run the packager with a newer Firefox build to
  update; the existing profile is preserved.
- **USB flash is not archival storage.** Keep a separate backup of anything you cannot
  afford to lose.

For high-risk use, a mature password manager with a supported portable workflow is a
better choice than any bespoke vault, including this one.

## 8. Reporting a problem

Security issues can be reported through the repository's issue tracker. Do not include
real vault files, master passwords or personal data in a report.