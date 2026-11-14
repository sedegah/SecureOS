import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.hashwasm = require('../interface/vendor/argon2.umd.min.js');

const {
  createVault, unlockVault, sealVault, validateEnvelope, VaultError, MIN_MASTER_LENGTH,
  MAX_VAULT_FILE_BYTES, encryptVaultFile, decryptVaultFile,
} = await import('../interface/modules/vault-crypto.js');

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
const FILE_ID = '8a2bd019-1537-4d8c-9e27-98e4cb6e1af3';
const OTHER_ID = '196b8ec6-5937-4e2f-b3ed-8c6df78bc843';
const hasCode = (code) => (error) => error instanceof VaultError && error.code === code;

async function withPatch(target, field, replacement, fn) {
  const original = target[field];
  target[field] = replacement;
  try {
    return await fn();
  } finally {
    target[field] = original;
  }
}

async function withoutCrypto(fn) {
  let calls = 0;
  const unexpected = () => { calls += 1; throw new Error('Crypto must not run for invalid input'); };
  await withPatch(globalThis, 'hashwasm', { argon2id: unexpected }, () =>
    withPatch(crypto, 'getRandomValues', unexpected, () =>
      withPatch(crypto.subtle, 'encrypt', unexpected, () =>
        withPatch(crypto.subtle, 'decrypt', unexpected, () =>
          withPatch(crypto.subtle, 'importKey', unexpected, fn)))));
  assert.equal(calls, 0, 'invalid inputs must be rejected before crypto');
}

// Independent fixture encoder: permits historic and deliberately malformed authenticated payloads.
async function sealManifestText(text) {
  const { key, envelope } = created;
  const kdf = envelope.kdf;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(text);
  try {
    const ciphertext = await crypto.subtle.encrypt({
      name: 'AES-GCM', iv, tagLength: 128,
      additionalData: new TextEncoder().encode(
        `surge-vault-v1|${kdf.algorithm}|${kdf.memoryKiB}|${kdf.iterations}|${kdf.parallelism}|${kdf.salt}`,
      ),
    }, key, plaintext);
    return { ...envelope, iv: Buffer.from(iv).toString('base64'), ciphertext: Buffer.from(ciphertext).toString('base64') };
  } finally {
    plaintext.fill(0);
  }
}

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
  assert.equal(created.key.extractable, false);
  assert.deepEqual(created.key.algorithm, { name: 'AES-GCM', length: 256 });
  await assert.rejects(() => crypto.subtle.exportKey('raw', created.key));
});

await test('correct master password unlocks and returns empty entries and files', async () => {
  const { key, vault } = await unlockVault(created.envelope, MASTER);
  assert.deepEqual(vault, { version: 1, entries: [], files: [] });
  assert.equal(key.extractable, false);
  await assert.rejects(() => crypto.subtle.exportKey('raw', key));
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

await test('binary files, empty files and base64 chunk boundaries round trip', async () => {
  for (const length of [0, 1, 2, 3, 256, 0x6000 - 1, 0x6000, 0x6000 + 1, 0xc000]) {
    const bytes = Uint8Array.from({ length }, (_, i) => i % 256);
    const original = bytes.slice();
    const sealed = await encryptVaultFile(created.key, created.envelope, FILE_ID, bytes);
    assert.deepEqual(Object.keys(sealed).sort(), ['cipher', 'ciphertext', 'iv', 'version']);
    assert.equal(sealed.version, 1);
    assert.equal(sealed.cipher, 'AES-256-GCM');
    assert.equal(Buffer.from(sealed.iv, 'base64').length, 12);
    assert.equal(Buffer.from(sealed.ciphertext, 'base64').length, length + 16);
    assert.equal(Buffer.from(sealed.ciphertext, 'base64').toString('base64'), sealed.ciphertext);
    const decrypted = await decryptVaultFile(created.key, created.envelope, FILE_ID, JSON.parse(JSON.stringify(sealed)));
    assert.ok(decrypted instanceof Uint8Array);
    assert.deepEqual(decrypted, original);
    assert.deepEqual(bytes, original, 'encryption must not clear caller-owned bytes');
  }
});

await test('encryption respects Uint8Array view offsets and leaves backing bytes intact', async () => {
  const backing = new Uint8Array([99, 0, 255, 128, 77]);
  const original = backing.slice();
  const sealed = await encryptVaultFile(created.key, created.envelope, FILE_ID, backing.subarray(1, 4));
  assert.deepEqual(await decryptVaultFile(created.key, created.envelope, FILE_ID, sealed), original.slice(1, 4));
  assert.deepEqual(backing, original);
});

await test('the exact 16 MiB maximum round trips without changing caller bytes', async () => {
  assert.equal(MAX_VAULT_FILE_BYTES, 16 * 1024 * 1024);
  const bytes = new Uint8Array(MAX_VAULT_FILE_BYTES);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251;
  const sealed = await encryptVaultFile(created.key, created.envelope, FILE_ID, bytes);
  assert.equal(Buffer.from(sealed.ciphertext, 'base64').length, MAX_VAULT_FILE_BYTES + 16);
  assert.deepEqual(await decryptVaultFile(created.key, created.envelope, FILE_ID, sealed), bytes);
  assert.equal(bytes[250], 250);
  assert.equal(bytes[bytes.length - 1], (bytes.length - 1) % 251);
});

await test('oversize files and non-Uint8Array inputs fail before crypto', async () => {
  await withoutCrypto(async () => {
    await assert.rejects(() => encryptVaultFile(created.key, created.envelope, FILE_ID,
      new Uint8Array(MAX_VAULT_FILE_BYTES + 1)), hasCode('too-large'));
    for (const bytes of [null, undefined, '', [], {}, new ArrayBuffer(2), new DataView(new ArrayBuffer(2)), new Uint16Array(2)]) {
      await assert.rejects(() => encryptVaultFile(created.key, created.envelope, FILE_ID, bytes), hasCode('invalid-file'));
    }
  });
});

await test('every file encryption gets a fresh random 12-byte IV, including empty files', async () => {
  const ivs = new Set([created.envelope.iv]);
  const ciphertexts = new Set();
  for (let i = 0; i < 32; i += 1) {
    const sealed = await encryptVaultFile(created.key, created.envelope, FILE_ID, new Uint8Array());
    assert.equal(Buffer.from(sealed.iv, 'base64').length, 12);
    assert.ok(!ivs.has(sealed.iv));
    assert.ok(!ciphertexts.has(sealed.ciphertext));
    ivs.add(sealed.iv);
    ciphertexts.add(sealed.ciphertext);
  }
});

await test('file AAD uses the exact domain, vault salt and canonical lowercase UUID', async () => {
  const bytes = new Uint8Array([0, 255, 42]);
  const sealed = await encryptVaultFile(created.key, created.envelope, FILE_ID.toUpperCase(), bytes);
  assert.deepEqual(await decryptVaultFile(created.key, created.envelope, FILE_ID, sealed), bytes);
  assert.deepEqual(await decryptVaultFile(created.key, created.envelope, FILE_ID.toUpperCase(), sealed), bytes);
  const plaintext = await crypto.subtle.decrypt({
    name: 'AES-GCM', iv: Buffer.from(sealed.iv, 'base64'), tagLength: 128,
    additionalData: new TextEncoder().encode(`surge-vault-file-v1|${created.envelope.kdf.salt}|${FILE_ID}`),
  }, created.key, Buffer.from(sealed.ciphertext, 'base64'));
  assert.deepEqual(new Uint8Array(plaintext), bytes);
});

await test('file ciphertext, authentication tag and IV tampering are rejected', async () => {
  const sealed = await encryptVaultFile(created.key, created.envelope, FILE_ID, new Uint8Array([1, 2, 3]));
  for (const [field, index] of [['ciphertext', 0], ['ciphertext', 18], ['iv', 0]]) {
    const raw = Buffer.from(sealed[field], 'base64');
    raw[index] ^= 1;
    await assert.rejects(() => decryptVaultFile(created.key, created.envelope, FILE_ID,
      { ...sealed, [field]: raw.toString('base64') }), hasCode('decrypt'));
  }
});

await test('wrong keys, file IDs and vault salts fail authentication without disclosing contents', async () => {
  const secret = 'private file contents';
  const sealed = await encryptVaultFile(created.key, created.envelope, FILE_ID, new TextEncoder().encode(secret));
  const wrongKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const salt = Buffer.from(created.envelope.kdf.salt, 'base64');
  salt[0] ^= 1;
  const otherVault = { ...created.envelope, kdf: { ...created.envelope.kdf, salt: salt.toString('base64') } };
  for (const [key, envelope, id] of [
    [wrongKey, created.envelope, FILE_ID], [created.key, created.envelope, OTHER_ID], [created.key, otherVault, FILE_ID],
  ]) {
    await assert.rejects(() => decryptVaultFile(key, envelope, id, sealed), (error) => {
      assert.ok(hasCode('decrypt')(error));
      for (const value of [secret, FILE_ID, OTHER_ID, envelope.kdf.salt, sealed.ciphertext]) {
        assert.ok(!error.message.includes(value));
      }
      assert.ok(!error.message.includes('password'));
      return true;
    });
  }
});

await test('file blobs and encrypted manifests cannot be substituted for each other', async () => {
  const { version, cipher, iv, ciphertext } = created.envelope;
  await assert.rejects(() => decryptVaultFile(created.key, created.envelope, FILE_ID,
    { version, cipher, iv, ciphertext }), hasCode('decrypt'));
  const file = await encryptVaultFile(created.key, created.envelope, FILE_ID,
    new TextEncoder().encode('{"version":1,"entries":[],"files":[]}'));
  await assert.rejects(() => unlockVault({ ...created.envelope, ...file }, MASTER), hasCode('wrong-password'));
});

await test('malformed UUIDs are rejected before encryption or decryption', async () => {
  const sealed = await encryptVaultFile(created.key, created.envelope, FILE_ID, new Uint8Array());
  await withoutCrypto(async () => {
    for (const id of [undefined, null, 123, {}, '', '../private.txt', FILE_ID.replaceAll('-', ''),
      `${FILE_ID}\n`, ` ${FILE_ID}`, FILE_ID.replace('8', 'z'), `{${FILE_ID}}`]) {
      await assert.rejects(() => encryptVaultFile(created.key, created.envelope, id, new Uint8Array()), hasCode('corrupt'));
      await assert.rejects(() => decryptVaultFile(created.key, created.envelope, id, sealed), hasCode('corrupt'));
    }
  });
});

await test('invalid keys, AES-128 keys and missing usages are rejected before crypto', async () => {
  const sealed = await encryptVaultFile(created.key, created.envelope, FILE_ID, new Uint8Array());
  const shortKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, false, ['encrypt', 'decrypt']);
  const cbcKey = await crypto.subtle.generateKey({ name: 'AES-CBC', length: 256 }, false, ['encrypt', 'decrypt']);
  const encryptOnly = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const decryptOnly = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  await withoutCrypto(async () => {
    for (const key of [null, undefined, {}, new Uint8Array(32), shortKey, cbcKey]) {
      await assert.rejects(() => encryptVaultFile(key, created.envelope, FILE_ID, new Uint8Array()), hasCode('key'));
      await assert.rejects(() => decryptVaultFile(key, created.envelope, FILE_ID, sealed), hasCode('key'));
    }
    await assert.rejects(() => encryptVaultFile(decryptOnly, created.envelope, FILE_ID, new Uint8Array()), hasCode('key'));
    await assert.rejects(() => decryptVaultFile(encryptOnly, created.envelope, FILE_ID, sealed), hasCode('key'));
  });
});

await test('malformed envelopes are rejected before KDF, encryption or decryption', async () => {
  const envelope = created.envelope;
  const sealed = await encryptVaultFile(created.key, envelope, FILE_ID, new Uint8Array());
  const badEnvelopes = [null, [], {}, { ...envelope, version: '1' }, { ...envelope, cipher: 'AES-CBC' },
    { ...envelope, kdf: null }, { ...envelope, kdf: [] }];
  for (const [field, values] of [
    ['algorithm', ['argon2i', null]], ['memoryKiB', [8191, 1048577, 8192.5, '65536', NaN]],
    ['iterations', [0, 11, 1.5, null]], ['parallelism', [0, 17, 1.5, '1']],
    ['salt', [null, '', '!', 'A'.repeat(22) + 'B=', 'A'.repeat(21) + 'B==',
      Buffer.alloc(15).toString('base64'), Buffer.alloc(17).toString('base64'), `${envelope.kdf.salt}\n`]],
  ]) {
    for (const value of values) badEnvelopes.push({ ...envelope, kdf: { ...envelope.kdf, [field]: value } });
  }
  for (const [field, values] of [
    ['iv', [null, '', Buffer.alloc(11).toString('base64'), Buffer.alloc(13).toString('base64'), 'A'.repeat(15) + '!']],
    ['ciphertext', [null, '', Buffer.alloc(15).toString('base64'), 'A'.repeat(21) + 'B==', envelope.ciphertext + '\n']],
  ]) {
    for (const value of values) badEnvelopes.push({ ...envelope, [field]: value });
  }
  await withoutCrypto(async () => {
    for (const bad of badEnvelopes) {
      assert.throws(() => validateEnvelope(bad), hasCode('corrupt'));
      await assert.rejects(() => unlockVault(bad, MASTER), hasCode('corrupt'));
      await assert.rejects(() => encryptVaultFile(created.key, bad, FILE_ID, new Uint8Array()), hasCode('corrupt'));
      await assert.rejects(() => decryptVaultFile(created.key, bad, FILE_ID, sealed), hasCode('corrupt'));
      await assert.rejects(() => sealVault(created.key, bad, { version: 1, entries: [], files: [] }), hasCode('corrupt'));
    }
  });
});

await test('malformed blobs and noncanonical base64 fail before crypto', async () => {
  const sealed = await encryptVaultFile(created.key, created.envelope, FILE_ID, new Uint8Array());
  const badBlobs = [null, undefined, [], {}, JSON.stringify(sealed),
    { ...sealed, version: 2 }, { ...sealed, cipher: 'AES-128-GCM' }, { ...sealed, name: 'private.txt' }];
  for (const iv of [undefined, null, 12, '', Buffer.alloc(11).toString('base64'), Buffer.alloc(13).toString('base64'),
    sealed.iv + '\n', 'A'.repeat(15) + '_', 'A'.repeat(15) + ' ']) badBlobs.push({ ...sealed, iv });
  for (const ciphertext of [null, {}, '', Buffer.alloc(15).toString('base64'), 'A'.repeat(21) + 'B==',
    'A'.repeat(22) + 'B=', 'A'.repeat(20) + '====', 'A'.repeat(21) + '_==', sealed.ciphertext.replaceAll('=', ''),
    sealed.ciphertext + '\n']) badBlobs.push({ ...sealed, ciphertext });
  await withoutCrypto(async () => {
    for (const bad of badBlobs) {
      await assert.rejects(() => decryptVaultFile(created.key, created.envelope, FILE_ID, bad), hasCode('corrupt'));
    }
  });
});

await test('ciphertext bounds account for padding and the 128-bit tag before crypto', async () => {
  const sealed = await encryptVaultFile(created.key, created.envelope, FILE_ID, new Uint8Array());
  const maxEncodedLength = 4 * Math.ceil((MAX_VAULT_FILE_BYTES + 16) / 3);
  // Without padding this decodes to one byte beyond the maximum despite the same encoded length.
  for (const length of [maxEncodedLength, maxEncodedLength + 4]) {
    const ciphertext = 'A'.repeat(length);
    await withoutCrypto(async () => {
      await assert.rejects(() => decryptVaultFile(created.key, created.envelope, FILE_ID, { ...sealed, ciphertext }), hasCode('corrupt'));
      await assert.rejects(() => unlockVault({ ...created.envelope, ciphertext }, MASTER), hasCode('corrupt'));
    });
  }
});

await test('historic password-only payloads load with files defaulting to an empty array', async () => {
  const entry = { id: 'historic-id', title: 'Mail', username: 'kim', password: 'unchanged', notes: 'old note' };
  const envelope = await sealManifestText(JSON.stringify({ version: 1, entries: [entry] }));
  const { vault } = await unlockVault(envelope, MASTER);
  assert.deepEqual(vault, { version: 1, entries: [entry], files: [] });
});

await test('passwords and file metadata persist together, with filenames only inside the encrypted manifest', async () => {
  const name = 'Private payroll — November.pdf';
  const body = new TextEncoder().encode('confidential binary file content');
  const file = await encryptVaultFile(created.key, created.envelope, FILE_ID, body);
  const vault = {
    version: 1,
    entries: [{ id: '1', title: 'Mail', username: 'kim', password: 'keep this password', notes: 'line\nbreak' }],
    files: [{ id: FILE_ID, name, size: body.length }, { id: OTHER_ID, name: 'empty.txt', size: 0 }],
  };
  const envelope = await sealVault(created.key, created.envelope, vault);
  const publicData = JSON.stringify({ envelope, file });
  for (const secret of [name, 'empty.txt', vault.entries[0].password, new TextDecoder().decode(body)]) {
    assert.ok(!publicData.includes(secret));
  }
  assert.ok(!Object.hasOwn(envelope, 'files'));
  assert.deepEqual(Object.keys(file).sort(), ['cipher', 'ciphertext', 'iv', 'version']);
  const unlocked = await unlockVault(envelope, MASTER);
  assert.deepEqual(unlocked.vault, vault);
  unlocked.vault.entries[0].password = 'changed password';
  unlocked.vault.files[0].name = 'renamed-private.pdf';
  const saved = await sealVault(unlocked.key, envelope, unlocked.vault);
  const reloaded = await unlockVault(saved, MASTER);
  assert.deepEqual(reloaded.vault, unlocked.vault);
  assert.deepEqual(await decryptVaultFile(reloaded.key, saved, FILE_ID, file), body);
});

await test('file metadata permits sizes at both inclusive bounds', async () => {
  const vault = { version: 1, entries: [], files: [
    { id: FILE_ID, name: '', size: 0 }, { id: OTHER_ID.toUpperCase(), name: 'max.bin', size: MAX_VAULT_FILE_BYTES },
  ] };
  const envelope = await sealVault(created.key, created.envelope, vault);
  assert.deepEqual((await unlockVault(envelope, MASTER)).vault, vault);
});

await test('malformed authenticated payloads are corrupt, not password errors, and cannot be saved', async () => {
  const metadata = { id: FILE_ID, name: 'private-name.txt', size: 1 };
  const invalid = [null, [], {}, { entries: [] }, { version: 2, entries: [] }, { version: 1, entries: {} }];
  for (const files of [null, {}, 'private body']) invalid.push({ version: 1, entries: [], files });
  for (const file of [null, [], 'plaintext body', {}, { ...metadata, id: 'not-a-uuid' },
    { ...metadata, name: null }, { ...metadata, name: 123 }, { ...metadata, size: -1 },
    { ...metadata, size: 1.5 }, { ...metadata, size: '1' }, { ...metadata, size: MAX_VAULT_FILE_BYTES + 1 },
    { ...metadata, body: 'private body' }, { ...metadata, bytes: [1] }, { ...metadata, content: 'private body' }]) {
    invalid.push({ version: 1, entries: [], files: [file] });
  }
  for (const vault of invalid) {
    const envelope = await sealManifestText(JSON.stringify(vault));
    await assert.rejects(() => unlockVault(envelope, MASTER), (error) => {
      assert.ok(hasCode('corrupt')(error));
      assert.ok(!error.message.includes(metadata.name));
      assert.ok(!error.message.includes('private body'));
      return true;
    });
    await withoutCrypto(() => assert.rejects(() => sealVault(created.key, created.envelope, vault), hasCode('corrupt')));
  }
});

await test('seal clears owned plaintext on success and failure, without mutating the payload', async () => {
  const originalEncrypt = crypto.subtle.encrypt;
  const vault = { version: 1, entries: [{ password: 'keep original' }], files: [] };
  let plaintext;
  await withPatch(crypto.subtle, 'encrypt', function (...args) {
    plaintext = args[2];
    return originalEncrypt.apply(this, args);
  }, () => sealVault(created.key, created.envelope, vault));
  assert.ok(plaintext.length > 0);
  assert.ok(plaintext.every((byte) => byte === 0));
  await withPatch(crypto.subtle, 'encrypt', async (...args) => {
    plaintext = args[2];
    throw new Error('simulated encryption failure');
  }, () => assert.rejects(() => sealVault(created.key, created.envelope, vault), /simulated encryption failure/));
  assert.ok(plaintext.every((byte) => byte === 0));
  assert.equal(vault.entries[0].password, 'keep original');
});

await test('unseal clears owned decrypted bytes on success, malformed JSON and invalid metadata', async () => {
  const originalDecrypt = crypto.subtle.decrypt;
  const invalidJson = await sealManifestText('{"private body": secret');
  const invalidMetadata = await sealManifestText('{"version":1,"entries":[],"files":[{"body":"secret"}]}');
  for (const envelope of [created.envelope, invalidJson, invalidMetadata]) {
    let plaintext;
    await withPatch(crypto.subtle, 'decrypt', async function (...args) {
      const result = await originalDecrypt.apply(this, args);
      plaintext = new Uint8Array(result);
      return result;
    }, async () => {
      if (envelope === created.envelope) await unlockVault(envelope, MASTER);
      else await assert.rejects(() => unlockVault(envelope, MASTER), (error) => {
        assert.ok(hasCode('corrupt')(error));
        assert.ok(!error.message.includes('secret'));
        return true;
      });
    });
    assert.ok(plaintext.length > 0);
    assert.ok(plaintext.every((byte) => byte === 0));
  }
});

await test('failed file encryption preserves caller bytes and reports encryption, not a password error', async () => {
  const bytes = new Uint8Array([1, 2, 255]);
  await withPatch(crypto.subtle, 'encrypt', async () => {
    throw new Error('internal details and secret contents');
  }, () => assert.rejects(() => encryptVaultFile(created.key, created.envelope, FILE_ID, bytes), (error) => {
    assert.ok(hasCode('encrypt')(error));
    assert.ok(!error.message.includes('secret'));
    assert.ok(!error.message.includes('password'));
    return true;
  }));
  assert.deepEqual(bytes, new Uint8Array([1, 2, 255]));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);