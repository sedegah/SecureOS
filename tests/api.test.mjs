import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const exeSource = path.join(repoRoot, 'build', 'publish', 'Surge.exe');
if (!fs.existsSync(exeSource)) {
  console.error('Surge.exe not found. Run packaging/build.ps1 first.');
  process.exit(1);
}

const usbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surge-usb-'));
fs.copyFileSync(exeSource, path.join(usbRoot, 'Surge.exe'));
fs.cpSync(path.join(repoRoot, 'interface'), path.join(usbRoot, 'Interface'), { recursive: true });

let passed = 0;
let failed = 0;
let skipped = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    if (error?.skip) {
      skipped += 1;
      console.log(`  skip ${name} - ${error.message}`);
      return;
    }
    failed += 1;
    console.log(`  FAIL ${name}\n       ${error.stack?.split('\n').slice(0, 3).join('\n       ')}`);
  }
}

function skip(reason) {
  const error = new Error(reason);
  error.skip = true;
  throw error;
}

const child = spawn(path.join(usbRoot, 'Surge.exe'), ['--no-browser'], {
  cwd: usbRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

const url = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Surge.exe did not report a URL. stderr: ${stderr}`)), 30000);
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const match = buffer.match(/SURGE_URL=(\S+)/);
    if (match) {
      clearTimeout(timer);
      resolve(match[1]);
    }
  });
  child.on('exit', (code) => {
    clearTimeout(timer);
    reject(new Error(`Surge.exe exited with ${code}. stderr: ${stderr}`));
  });
});

const base = url.split('#')[0].replace(/\/+$/, '');
const token = url.split('k=')[1];
const auth = { 'X-Surge-Token': token };

async function call(method, endpoint, body, headers = {}) {
  const response = await fetch(base + endpoint, {
    method,
    headers: { ...auth, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON response */ }
  return { status: response.status, json, text, headers: response.headers };
}

function rawRequest(headers) {
  return new Promise((resolve, reject) => {
    const target = new URL(base);
    const request = http.request({ host: target.hostname, port: target.port, path: '/api/status', headers }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end();
  });
}

const doc = (name, payload) => call('PUT', `/api/doc/${name}`, payload);

console.log(`helper api (temporary USB at ${usbRoot})`);

await test('status reports the runtime USB location and storage', async () => {
  const { status, json } = await call('GET', '/api/status');
  assert.equal(status, 200);
  assert.equal(json.app, 'Surge Portable');
  assert.equal(json.usbPresent, true);
  assert.equal(json.usbRoot, usbRoot);
  assert.ok(json.storage.total > 0);
  assert.equal(typeof json.storage.low, 'boolean');
});

await test('launcher created the data directories on the USB', () => {
  for (const dir of ['Data/Profile', 'Data/Notes', 'Data/Bookmarks', 'Data/Settings', 'Data/PasswordVault', 'Downloads']) {
    assert.ok(fs.existsSync(path.join(usbRoot, dir)), `${dir} missing`);
  }
});

await test('requests without a token are rejected', async () => {
  const response = await fetch(`${base}/api/status`);
  assert.equal(response.status, 401);
});

await test('requests with a wrong token are rejected', async () => {
  const { status } = await call('GET', '/api/status', undefined, { 'X-Surge-Token': 'f'.repeat(token.length) });
  assert.equal(status, 401);
});

await test('cross-site requests are rejected', async () => {
  const { status } = await call('GET', '/api/status', undefined, { 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(status, 403);
});

await test('foreign Origin headers are rejected', async () => {
  const { status } = await call('GET', '/api/status', undefined, { Origin: 'https://evil.example' });
  assert.equal(status, 403);
});

await test('DNS-rebinding style Host headers are rejected', async () => {
  assert.equal(await rawRequest({ Host: 'evil.example', 'X-Surge-Token': token }), 403);
});

await test('the homepage and its assets are served', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Surge Portable/);
  for (const asset of ['/styles.css', '/app.js', '/modules/api.js', '/vendor/argon2.umd.min.js', '/assets/surge.svg']) {
    const response = await fetch(base + asset);
    assert.equal(response.status, 200, `${asset} not served`);
  }
});

await test('static file traversal is refused', async () => {
  for (const attempt of ['/..%2fSurge.exe', '/%2e%2e/%2e%2e/Windows/win.ini']) {
    const response = await fetch(base + attempt);
    assert.ok(response.status === 400 || response.status === 404, `${attempt} returned ${response.status}`);
  }
});

await test('notes round trip and backup copy', async () => {
  assert.equal((await call('GET', '/api/doc/notes')).status, 404);
  const first = { version: 1, notes: [{ id: 'n1', title: 'First', body: 'one', modifiedAt: '2026-11-14T10:00:00Z' }] };
  assert.equal((await doc('notes', first)).status, 200);
  const second = { version: 1, notes: [{ id: 'n1', title: 'First', body: 'two', modifiedAt: '2026-11-14T10:05:00Z' }] };
  assert.equal((await doc('notes', second)).status, 200);

  const read = await call('GET', '/api/doc/notes');
  assert.deepEqual(read.json, second);
  const backup = JSON.parse(fs.readFileSync(path.join(usbRoot, 'Data/Notes/notes.json.bak'), 'utf8'));
  assert.deepEqual(backup, first);
  assert.ok(!fs.existsSync(path.join(usbRoot, 'Data/Notes/notes.json.tmp')), 'temporary file left behind');
});

await test('a damaged notes file is recovered from its backup', async () => {
  const notesPath = path.join(usbRoot, 'Data/Notes/notes.json');
  const good = fs.readFileSync(notesPath);
  fs.writeFileSync(notesPath, '{"version":1,"notes":[{"id":"n1","title":"trunc');
  const read = await call('GET', '/api/doc/notes');
  assert.equal(read.status, 200);
  assert.equal(read.headers.get('x-surge-source'), 'backup');
  assert.equal(read.json.notes[0].body, 'one');
  fs.writeFileSync(notesPath, good);
});

await test('settings and bookmarks are stored separately', async () => {
  assert.equal((await doc('settings', { version: 1, theme: 'light', searchEngine: 'duckduckgo' })).status, 200);
  assert.equal((await doc('bookmarks', { version: 1, folders: [], items: [{ id: 'b1', title: 'Example', url: 'https://example.org' }] })).status, 200);
  assert.equal((await call('GET', '/api/doc/settings')).json.theme, 'light');
  assert.equal((await call('GET', '/api/doc/bookmarks')).json.items.length, 1);
});

await test('invalid JSON and unknown documents are rejected', async () => {
  const response = await fetch(`${base}/api/doc/notes`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: 'not json' });
  assert.equal(response.status, 400);
  assert.equal((await call('GET', '/api/doc/secrets')).status, 404);
  assert.equal((await call('PUT', '/api/doc/vault', { version: 1 })).status, 404);
});

await test('vault is stored as ciphertext and read back unchanged', async () => {
  const envelope = { version: 1, kdf: { algorithm: 'argon2id', memoryKiB: 65536, iterations: 3, parallelism: 1, salt: 'c2FsdA==' }, cipher: 'AES-256-GCM', iv: 'aXY=', ciphertext: 'Y2lwaGVy', createdAt: '2026-11-14T10:00:00Z', updatedAt: '2026-11-14T10:00:00Z' };
  assert.equal((await call('PUT', '/api/vault', envelope)).status, 200);
  const read = await call('GET', '/api/vault');
  assert.deepEqual(read.json, envelope);
  const onDisk = fs.readFileSync(path.join(usbRoot, 'Data/PasswordVault/vault.enc'), 'utf8');
  assert.ok(!onDisk.includes('masterPassword'));
  assert.ok(!fs.existsSync(path.join(usbRoot, 'Data/PasswordVault/vault.enc.tmp')));
});

await test('file manager lists, creates, renames, copies, moves and deletes', async () => {
  fs.writeFileSync(path.join(usbRoot, 'Downloads', 'report.txt'), 'downloaded content');
  const root = await call('GET', '/api/files?path=');
  assert.equal(root.status, 200);
  assert.ok(root.json.entries.some((entry) => entry.name === 'Downloads' && entry.type === 'dir'));

  assert.equal((await call('POST', '/api/files/mkdir', { path: '', name: 'Documents' })).status, 200);
  assert.equal((await call('POST', '/api/files/mkdir', { path: 'Documents', name: 'Work' })).status, 200);

  const listing = await call('GET', '/api/files?path=Downloads');
  const file = listing.json.entries.find((entry) => entry.name === 'report.txt');
  assert.equal(file.size, 18);
  assert.ok(file.modified);

  assert.equal((await call('POST', '/api/files/rename', { path: 'Downloads/report.txt', name: 'final.txt' })).status, 200);
  assert.equal((await call('POST', '/api/files/transfer', { path: 'Downloads/final.txt', destination: 'Documents/Work', move: false })).status, 200);
  assert.ok(fs.existsSync(path.join(usbRoot, 'Documents/Work/final.txt')));
  assert.ok(fs.existsSync(path.join(usbRoot, 'Downloads/final.txt')));

  assert.equal((await call('POST', '/api/files/transfer', { path: 'Downloads/final.txt', destination: 'Documents', move: true, confirm: true })).status, 200);
  assert.ok(!fs.existsSync(path.join(usbRoot, 'Downloads/final.txt')));
  assert.ok(fs.existsSync(path.join(usbRoot, 'Documents/final.txt')));

  assert.equal((await call('POST', '/api/files/delete', { path: 'Documents/final.txt', confirm: true })).status, 200);
  assert.ok(!fs.existsSync(path.join(usbRoot, 'Documents/final.txt')));
});

await test('deleting and moving require explicit confirmation', async () => {
  fs.writeFileSync(path.join(usbRoot, 'Downloads', 'guarded.txt'), 'x');
  assert.equal((await call('POST', '/api/files/delete', { path: 'Downloads/guarded.txt' })).status, 400);
  assert.equal((await call('POST', '/api/files/transfer', { path: 'Downloads/guarded.txt', destination: 'Documents', move: true })).status, 400);
  assert.ok(fs.existsSync(path.join(usbRoot, 'Downloads/guarded.txt')));
});

await test('copy conflicts are refused instead of overwriting', async () => {
  fs.writeFileSync(path.join(usbRoot, 'Documents', 'final.txt'), 'existing');
  const { status } = await call('POST', '/api/files/transfer', { path: 'Downloads/guarded.txt', destination: 'Documents', move: false });
  assert.equal(status, 409);
  assert.equal(fs.readFileSync(path.join(usbRoot, 'Documents', 'final.txt'), 'utf8'), 'existing');
});

await test('paths outside the USB folder are refused', async () => {
  for (const attempt of ['../../Windows', '..\\..\\Windows', 'C:/Windows', '/etc', 'Downloads/../../Windows']) {
    const { status } = await call('GET', `/api/files?path=${encodeURIComponent(attempt)}`);
    assert.equal(status, 400, `${attempt} returned ${status}`);
  }
  const escaped = await call('POST', '/api/files/delete', { path: '../outside.txt', confirm: true });
  assert.equal(escaped.status, 400);
});

await test('Surge itself is protected from the file manager', async () => {
  assert.equal((await call('POST', '/api/files/delete', { path: 'Surge.exe', confirm: true })).status, 403);
  assert.equal((await call('POST', '/api/files/rename', { path: 'Interface', name: 'Old' })).status, 403);
  assert.ok(fs.existsSync(path.join(usbRoot, 'Surge.exe')));
});

await test('invalid file names are refused', async () => {
  for (const name of ['bad/name', 'bad:name', '..', '   ']) {
    assert.equal((await call('POST', '/api/files/mkdir', { path: '', name })).status, 400);
  }
});

await test('missing folders report a clear error', async () => {
  assert.equal((await call('GET', '/api/files?path=NoSuchFolder')).status, 404);
  assert.equal((await call('POST', '/api/files/delete', { path: 'NoSuchFolder/x.txt', confirm: true })).status, 404);
});

await test('oversized documents are refused', async () => {
  const huge = { version: 1, blob: 'x'.repeat(9 * 1024 * 1024) };
  const response = await fetch(`${base}/api/vault`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(huge) });
  assert.equal(response.status, 413);
});

await test('USB removal pauses writes without creating host folders', async () => {
  const parked = `${usbRoot}-parked`;
  try {
    fs.renameSync(usbRoot, parked);
  } catch {
    skip('Windows keeps the running executable locked, so the drive cannot be detached in-process');
  }
  try {
    const status = await call('GET', '/api/status');
    assert.equal(status.json.usbPresent, false);
    const write = await doc('notes', { version: 1, notes: [] });
    assert.equal(write.status, 503);
    assert.equal(write.json.error, 'usb-missing');
    const heartbeat = await call('GET', '/api/heartbeat');
    assert.equal(heartbeat.json.usbPresent, false);
    assert.ok(!fs.existsSync(path.join(os.tmpdir(), 'Data')), 'host-side Data folder was created');
  } finally {
    fs.renameSync(parked, usbRoot);
  }
  const recovered = await call('GET', '/api/status');
  assert.equal(recovered.json.usbPresent, true);
});

await test('data survives a helper restart', async () => {
  child.kill();
  await new Promise((resolve) => child.once('exit', resolve));

  const restarted = spawn(path.join(usbRoot, 'Surge.exe'), ['--no-browser'], { cwd: usbRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  const nextUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('restart did not report a URL')), 30000);
    let buffer = '';
    restarted.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(/SURGE_URL=(\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const nextBase = nextUrl.split('#')[0].replace(/\/+$/, '');
  const nextToken = nextUrl.split('k=')[1];
  try {
    const response = await fetch(`${nextBase}/api/doc/notes`, { headers: { 'X-Surge-Token': nextToken } });
    const notes = await response.json();
    assert.equal(notes.notes[0].id, 'n1');
    const vault = await fetch(`${nextBase}/api/vault`, { headers: { 'X-Surge-Token': nextToken } });
    assert.equal((await vault.json()).cipher, 'AES-256-GCM');
    assert.notEqual(nextToken, token, 'each launch must issue a fresh session token');
  } finally {
    restarted.kill();
    await new Promise((resolve) => restarted.once('exit', resolve));
  }
});

console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);

try {
  if (!child.killed && child.exitCode === null) child.kill();
} catch { /* already gone */ }
fs.rmSync(usbRoot, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);