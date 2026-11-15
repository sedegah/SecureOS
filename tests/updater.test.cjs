const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseVersion,
  compareVersions,
  selectInstallerAsset,
  createUpdateService,
} = require('../desktop/update-service.cjs');

test('parses Surge release tags with and without the historical v. prefix', () => {
  assert.deepEqual(parseVersion('v.1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3]);
  assert.equal(parseVersion('latest'), null);
});

test('compares semantic versions numerically', () => {
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
});

test('selects only a stable release with a GitHub-hosted installer and SHA-256 digest', () => {
  const release = {
    tag_name: 'v.1.1.0',
    draft: false,
    prerelease: false,
    assets: [{
      name: 'Surge-Setup.exe',
      browser_download_url: 'https://github.com/sedegah/SurgeOS/releases/download/v.1.1.0/Surge-Setup.exe',
      digest: 'sha256:' + 'a'.repeat(64),
      size: 1000,
    }],
  };
  assert.equal(selectInstallerAsset(release).version, '1.1.0');
  assert.equal(selectInstallerAsset({ ...release, prerelease: true }), null);
  assert.equal(selectInstallerAsset({ ...release, assets: [{ ...release.assets[0], digest: null }] }), null);
  assert.equal(selectInstallerAsset({ ...release, assets: [{ ...release.assets[0], browser_download_url: 'http://evil.example/file.exe' }] }), null);
});

test('checks the latest release and ignores the current or older version', async () => {
  const release = {
    tag_name: 'v.1.1.0',
    draft: false,
    prerelease: false,
    body: 'Security and stability updates',
    html_url: 'https://github.com/sedegah/SurgeOS/releases/tag/v.1.1.0',
    assets: [{
      name: 'Surge-Setup.exe',
      browser_download_url: 'https://github.com/sedegah/SurgeOS/releases/download/v.1.1.0/Surge-Setup.exe',
      digest: 'sha256:' + 'b'.repeat(64),
      size: 1000,
    }],
  };
  const app = { getVersion: () => '1.0.0', getPath: () => '/tmp' };
  const service = createUpdateService({
    app,
    fetchImpl: async () => ({ ok: true, json: async () => release }),
  });
  const update = await service.checkForUpdate();
  assert.equal(update.version, '1.1.0');
  assert.equal(update.digest, 'b'.repeat(64));

  const currentService = createUpdateService({
    app: { ...app, getVersion: () => '1.1.0' },
    fetchImpl: async () => ({ ok: true, json: async () => release }),
  });
  assert.equal(await currentService.checkForUpdate(), null);
});
