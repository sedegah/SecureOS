const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createWriteStream } = require('node:fs');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const RELEASE_API = 'https://api.github.com/repos/sedegah/SurgeOS/releases/latest';
const INSTALLER_NAME = 'Surge-Setup.exe';
const MAX_INSTALLER_BYTES = 600 * 1024 * 1024;

function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^v?\.?([0-9]+)\.([0-9]+)\.([0-9]+)(?:[-+][0-9A-Za-z.-]+)?$/);
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error('Surge received an invalid version number.');
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

function selectInstallerAsset(release) {
  if (!release || release.draft || release.prerelease || typeof release.tag_name !== 'string') return null;
  const version = release.tag_name.replace(/^v\.?/, '');
  if (!parseVersion(version)) return null;
  const asset = Array.isArray(release.assets)
    ? release.assets.find(item => item && item.name === INSTALLER_NAME)
    : null;
  if (!asset || typeof asset.browser_download_url !== 'string') return null;
  const url = new URL(asset.browser_download_url);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
  const digest = typeof asset.digest === 'string' ? asset.digest.match(/^sha256:([a-f0-9]{64})$/i) : null;
  if (!digest) return null;
  return { version, url: url.href, digest: digest[1].toLowerCase(), size: Number(asset.size) || 0 };
}

function createUpdateService({ app, fetchImpl = global.fetch } = {}) {
  if (!app || typeof app.getVersion !== 'function' || typeof app.getPath !== 'function') {
    throw new TypeError('An Electron app instance is required.');
  }

  async function checkForUpdate() {
    const response = await fetchImpl(RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'SurgeOS-Updater',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`GitHub release check failed (HTTP ${response.status}).`);
    const release = await response.json();
    const asset = selectInstallerAsset(release);
    if (!asset) throw new Error('The latest Surge release does not contain a verifiable Windows installer.');
    if (compareVersions(asset.version, app.getVersion()) <= 0) return null;
    return {
      version: asset.version,
      url: asset.url,
      digest: asset.digest,
      size: asset.size,
      releaseNotes: typeof release.body === 'string' ? release.body.slice(0, 4000) : '',
      releaseUrl: typeof release.html_url === 'string' ? release.html_url : 'https://github.com/sedegah/SurgeOS/releases',
    };
  }

  async function downloadInstaller(update) {
    if (!update || !/^\d+\.\d+\.\d+$/.test(update.version) || !/^[a-f0-9]{64}$/.test(update.digest)) {
      throw new Error('The update information is invalid.');
    }
    const url = new URL(update.url);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
      throw new Error('The installer download location is not trusted.');
    }

    const response = await fetchImpl(url.href, {
      headers: { 'User-Agent': 'SurgeOS-Updater', Accept: 'application/octet-stream' },
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });
    if (!response.ok || !response.body || !response.url.startsWith('https://')) {
      throw new Error(`Surge installer download failed (HTTP ${response.status}).`);
    }

    const contentLength = Number(response.headers.get('content-length')) || 0;
    if (contentLength > MAX_INSTALLER_BYTES || (update.size && update.size > MAX_INSTALLER_BYTES)) {
      throw new Error('The installer exceeds the permitted download size.');
    }

    const directory = path.join(app.getPath('temp'), 'SurgeUpdates');
    await fs.promises.mkdir(directory, { recursive: true });
    const destination = path.join(directory, `Surge-Setup-${update.version}.exe`);
    const partial = destination + '.download';
    await fs.promises.rm(partial, { force: true });

    const hash = createHash('sha256');
    let bytes = 0;
    const verifier = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > MAX_INSTALLER_BYTES) return callback(new Error('The installer exceeds the permitted download size.'));
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(Readable.fromWeb(response.body), verifier, createWriteStream(partial, { flags: 'wx' }));
      if (update.size && bytes !== update.size) throw new Error('The downloaded installer size does not match GitHub release metadata.');
      if (hash.digest('hex') !== update.digest) throw new Error('The downloaded installer failed its SHA-256 integrity check.');
      await fs.promises.rename(partial, destination);
      return destination;
    } catch (error) {
      await fs.promises.rm(partial, { force: true });
      throw error;
    }
  }

  return { checkForUpdate, downloadInstaller };
}

module.exports = { createUpdateService, parseVersion, compareVersions, selectInstallerAsset };
