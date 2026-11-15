import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.hashwasm = require('../interface/vendor/argon2.umd.min.js');

const {
  createSecuredLockDocument, createOpenLockDocument, resealLockDocument, resealWithKey,
  unlockLockDocument, validateLockDocument, normalizeProfileName, LockError,
  MIN_LOCK_PASSWORD_LENGTH, MAX_LOCK_NAME_LENGTH,
} = await import('../interface/modules/lock-crypto.js');

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

const PASSWORD = 'open sesame please';
const OTHER_PASSWORD = 'a different passphrase';
const isLockError = (code) => (error) => error instanceof LockError && error.code === code;

console.log('lock screen credentials');

await test('a secured profile stores no readable password or verifier', async () => {
  const { document } = await createSecuredLockDocument('Ada Lovelace', PASSWORD);
  const serialized = JSON.stringify(document);
  assert.equal(serialized.includes(PASSWORD), false);
  assert.equal('password' in document, false);
  assert.equal('verifier' in document, false);
  assert.equal(document.secured, true);
  assert.equal(document.name, 'Ada Lovelace');
  assert.equal(document.kind, 'surge-lock');
  assert.equal(document.version, 1);
  assert.deepEqual(validateLockDocument(document).name, 'Ada Lovelace');
});

await test('the right password unlocks and returns the profile name', async () => {
  const { document } = await createSecuredLockDocument('Ada Lovelace', PASSWORD);
  const { name, key } = await unlockLockDocument(document, PASSWORD);
  assert.equal(name, 'Ada Lovelace');
  assert.ok(key instanceof CryptoKey);
});

await test('a wrong password is rejected without disclosing the name', async () => {
  const { document } = await createSecuredLockDocument('Ada Lovelace', PASSWORD);
  await assert.rejects(unlockLockDocument(document, OTHER_PASSWORD), isLockError('wrong-password'));
});

await test('every unlock uses a fresh ciphertext for the same password', async () => {
  const first = await createSecuredLockDocument('Ada', PASSWORD);
  const second = await createSecuredLockDocument('Ada', PASSWORD);
  assert.notEqual(first.document.kdf.salt, second.document.kdf.salt);
  assert.notEqual(first.document.ciphertext, second.document.ciphertext);
});

await test('tampered ciphertext does not unlock', async () => {
  const { document } = await createSecuredLockDocument('Ada', PASSWORD);
  const bytes = atob(document.ciphertext).split('');
  bytes[0] = String.fromCharCode(bytes[0].charCodeAt(0) ^ 0x01);
  const tampered = { ...document, ciphertext: btoa(bytes.join('')) };
  await assert.rejects(unlockLockDocument(tampered, PASSWORD), isLockError('wrong-password'));
});

await test('the profile name is bound into the ciphertext', async () => {
  const { document } = await createSecuredLockDocument('Ada', PASSWORD);
  await assert.rejects(unlockLockDocument({ ...document, name: 'Mallory' }, PASSWORD), isLockError('wrong-password'));
});

await test('a password-free profile validates and needs no password', async () => {
  const document = createOpenLockDocument('Ada');
  assert.deepEqual(validateLockDocument(document), { name: 'Ada', secured: false });
  const { name, key } = await unlockLockDocument(document, '');
  assert.equal(name, 'Ada');
  assert.equal(key, null);
});

await test('a password-free profile carrying ciphertext is corrupt', async () => {
  const document = { ...createOpenLockDocument('Ada'), ciphertext: 'AAAA' };
  assert.throws(() => validateLockDocument(document), isLockError('corrupt'));
});

await test('unsupported versions, kinds and fields are corrupt', async () => {
  const { document } = await createSecuredLockDocument('Ada', PASSWORD);
  assert.throws(() => validateLockDocument({ ...document, version: 2 }), isLockError('corrupt'));
  assert.throws(() => validateLockDocument({ ...document, kind: 'other' }), isLockError('corrupt'));
  assert.throws(() => validateLockDocument({ ...document, extra: true }), isLockError('corrupt'));
  assert.throws(() => validateLockDocument(null), isLockError('corrupt'));
  assert.throws(() => validateLockDocument('nope'), isLockError('corrupt'));
});

await test('structural damage is reported as corrupt, not as a wrong password', async () => {
  const { document } = await createSecuredLockDocument('Ada', PASSWORD);
  assert.throws(() => validateLockDocument({ ...document, secured: 'yes' }), isLockError('corrupt'));
  assert.throws(() => validateLockDocument({ ...document, cipher: 'AES-128-CBC' }), isLockError('corrupt'));
  assert.throws(() => validateLockDocument({ ...document, kdf: { ...document.kdf, iterations: 0 } }), isLockError('corrupt'));
  assert.throws(() => validateLockDocument({ ...document, kdf: { ...document.kdf, memoryKiB: 1024 } }), isLockError('corrupt'));
});

await test('short or non-string passwords are rejected', async () => {
  await assert.rejects(createSecuredLockDocument('Ada', 'abc'), isLockError('invalid-password'));
  await assert.rejects(createSecuredLockDocument('Ada', null), isLockError('invalid-password'));
  assert.ok(MIN_LOCK_PASSWORD_LENGTH >= 8);
});

await test('names are trimmed, collapsed and bounded', async () => {
  assert.equal(normalizeProfileName('  Ada   Lovelace  '), 'Ada Lovelace');
  assert.throws(() => normalizeProfileName('   '), isLockError('invalid-name'));
  assert.throws(() => normalizeProfileName(42), isLockError('invalid-name'));
  assert.throws(() => normalizeProfileName('a'.repeat(MAX_LOCK_NAME_LENGTH + 1)), isLockError('invalid-name'));
  assert.throws(() => normalizeProfileName('Ada|Lovelace'), isLockError('invalid-name'));
});

await test('resealing changes the password and invalidates the old one', async () => {
  const { document } = await createSecuredLockDocument('Ada', PASSWORD);
  const resealed = await resealLockDocument(document, 'Ada', OTHER_PASSWORD);
  await assert.rejects(unlockLockDocument(resealed.document, PASSWORD), isLockError('wrong-password'));
  const { name } = await unlockLockDocument(resealed.document, OTHER_PASSWORD);
  assert.equal(name, 'Ada');
  assert.equal(resealed.document.createdAt, document.createdAt);
});

await test('an unlocked profile can be renamed without re-entering the password', async () => {
  const { document, key } = await createSecuredLockDocument('Ada', PASSWORD);
  const renamed = await resealWithKey(document, key, 'Ada Byron');
  assert.equal(renamed.name, 'Ada Byron');
  assert.notEqual(renamed.ciphertext, document.ciphertext, 'renaming must re-seal under the new name');
  assert.notEqual(renamed.iv, document.iv);
  assert.equal(renamed.kdf.salt, document.kdf.salt, 'renaming must not need the password again');

  const unlocked = await unlockLockDocument(renamed, PASSWORD);
  assert.equal(unlocked.name, 'Ada Byron');
  await assert.rejects(unlockLockDocument(renamed, OTHER_PASSWORD), isLockError('wrong-password'));
});

await test('renaming without a key is refused', async () => {
  const { document } = await createSecuredLockDocument('Ada', PASSWORD);
  await assert.rejects(resealWithKey(document, null, 'Ada Byron'), isLockError('locked'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
