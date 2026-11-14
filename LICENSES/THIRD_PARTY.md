# Third-party components

Surge Portable itself is the original work of the repository owner. Choose a license for
the Surge source before publishing; nothing in this folder grants rights to Surge itself.

## hash-wasm (Argon2id)

- File: `interface/vendor/argon2.umd.min.js`
- Version: 4.13.0
- Author: Dani Biro
- License: MIT — full text in `hash-wasm-MIT.txt`
- Source: https://github.com/Daninet/hash-wasm
- Use: Argon2id key derivation for the password vault, running as WebAssembly inside the
  workspace page. The bundle is vendored so the vault works with no internet connection.

## Mozilla Firefox

- Files: `Browser/FirefoxPortable/App/Firefox64/**` in the packaged USB build (not in this repository)
- License: Mozilla Public License 2.0 — full text in `Firefox-MPL-2.0.txt`
- Source: https://www.mozilla.org/firefox/ and https://archive.mozilla.org/pub/firefox/
- The browser is downloaded from Mozilla at package time by `packaging/package.ps1`.
  Unmodified Mozilla binaries are redistributed under the MPL; the corresponding source
  is available from Mozilla at the URL above. "Firefox" is a Mozilla trademark — this
  project is not affiliated with or endorsed by Mozilla.

## .NET runtime

- The launcher is published self-contained, so it carries the .NET runtime inside `Surge.exe`.
- License: MIT (https://github.com/dotnet/runtime/blob/main/LICENSE.TXT)
- No separate .NET installation is required on the host computer.