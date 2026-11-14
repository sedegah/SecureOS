import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.hashwasm = require('../interface/vendor/argon2.umd.min.js');

const { createVault, unlockVault, sealVault, validateEnvelope, VaultError, MIN_MASTER_LENGTH } =
  await import('../interface/modules/vault-crypto.js');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${name}\n       ${error.message}`);
  }
}

const MASTER = 'correct horse battery staple';

console.log('vault crypto');

let created;
await test('create vault seals an empty vault with Argon2id + AES-256-GCM', async () => {
  created = await createVault(MASTER);
  assert.equal(created.envelope.version, 1);
  assert.equal(created.envelope.cipher, 'AES-256-GCM');
  assert.equal(created.envelope.kdf.algorithm, 'argon2id');
  assert.equal(created.envelope.kdf.memoryKiB, 65536);
  assert.equal(created.envelope.kdf.iterations, 3);
  assert.ok(created.envelope.ciphertext.length > 0);
  assert.ok(!JSON.stringify(created.envelope).includes(MASTER));
});

await test('correct master password unlocks and returns entries', async () => {
  const { vault } = await unlockVault(created.envelope, MASTER);
  assert.deepEqual(vault.entries, []);
});

await test('wrong master password keeps the vault locked', async () => {
  await assert.rejects(() => unlockVault(created.envelope, 'wrong password entirely'),
    (error) => error instanceof VaultError && error.code === 'wrong-password');
});

await test('entries survive a seal/unseal round trip', async () => {
  const entry = { id: '1', title: 'Mail', username: 'kim', password: 'p@ss w0rd "quoted"', url: 'https://example.org', notes: 'line\nbreak' };
  const sealed = await sealVault(created.key, created.envelope, { version: 1, entries: [entry] });
  assert.ok(!JSON.stringify(sealed).includes(entry.password));
  const { vault } = await unlockVault(sealed, MASTER);
  assert.deepEqual(vault.entries, [entry]);
});

await test('each save uses a fresh IV', async () => {
  const a = await sealVault(created.key, created.envelope, { version: 1, entries: [] });
  const b = await sealVault(created.key, created.envelope, { version: 1, entries: [] });
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
});

await test('tampered ciphertext is rejected', async () => {
  const sealed = await sealVault(created.key, created.envelope, { version: 1, entries: [{ id: 'x' }] });
  const raw = Buffer.from(sealed.ciphertext, 'base64');
  raw[0] ^= 0xff;
  const tampered = { ...sealed, ciphertext: raw.toString('base64') };
  await assert.rejects(() => unlockVault(tampered, MASTER), (error) => error.code === 'wrong-password');
});

await test('downgraded KDF parameters are rejected (authenticated metadata)', async () => {
  const sealed = await sealVault(created.key, created.envelope, { version: 1, entries: [] });
  const tampered = { ...sealed, kdf: { ...sealed.kdf, memoryKiB: 8192, iterations: 1 } };
  await assert.rejects(() => unlockVault(tampered, MASTER), (error) => error.code === 'wrong-password');
});

await test('truncated vault file is reported as corrupt', async () => {
  const sealed = await sealVault(created.key, created.envelope, { version: 1, entries: [] });
  const raw = Buffer.from(sealed.ciphertext, 'base64').subarray(0, 4);
  await assert.rejects(() => unlockVault({ ...sealed, ciphertext: raw.toString('base64') }, MASTER));
});

await test('unsupported envelope shapes are rejected before any key derivation', async () => {
  assert.throws(() => validateEnvelope({ version: 2 }), (error) => error.code === 'corrupt');
  assert.throws(() => validateEnvelope({ ...created.envelope, kdf: { ...created.envelope.kdf, memoryKiB: 99999999 } }),
    (error) => error.code === 'corrupt');
  assert.throws(() => validateEnvelope({ ...created.envelope, cipher: 'AES-CBC' }), (error) => error.code === 'corrupt');
});

await test('two vaults get different salts', async () => {
  const other = await createVault(MASTER);
  assert.notEqual(other.envelope.kdf.salt, created.envelope.kdf.salt);
});

await test('minimum master password length is enforced by the UI contract', () => {
  assert.equal(MIN_MASTER_LENGTH, 12);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);