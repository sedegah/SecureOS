
const KDF_DEFAULTS = { algorithm: 'argon2id', memoryKiB: 65536, iterations: 3, parallelism: 1 };
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MIN_MASTER_LENGTH = 12;
export const MAX_VAULT_FILE_BYTES = 16 * 1024 * 1024;

const MAX_CIPHERTEXT_BYTES = MAX_VAULT_FILE_BYTES + TAG_BYTES;

export class VaultError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function toBase64(bytes) {

  const chunks = [];
  for (let i = 0; i < bytes.length; i += 0x6000) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 0x6000))));
  }
  return chunks.join('');
}

function validateBase64(text, minBytes, maxBytes) {
  if (typeof text !== 'string' || text.length % 4 !== 0
    || text.length < 4 * Math.ceil(minBytes / 3) || text.length > 4 * Math.ceil(maxBytes / 3))
    throw new VaultError('corrupt', 'The encrypted data has an invalid length.');
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const byteLength = text.length / 4 * 3 - padding;

  if (byteLength < minBytes || byteLength > maxBytes
    || /[^A-Za-z0-9+/]/.test(text.slice(0, text.length - padding))
    || (padding && (BASE64_ALPHABET.indexOf(text[text.length - padding - 1]) & (padding === 2 ? 15 : 3))))
    throw new VaultError('corrupt', 'The encrypted data contains invalid base64.');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalFileId(id) {
  if (typeof id !== 'string' || id.length !== 36 || !UUID.test(id))
    throw new VaultError('corrupt', 'The vault file identifier must be a UUID.');
  return id.toLowerCase();
}

function validateKey(key, usage) {
  if (!(key instanceof CryptoKey) || key.type !== 'secret'
    || key.algorithm.name !== 'AES-GCM' || key.algorithm.length !== 256 || !key.usages.includes(usage))
    throw new VaultError('key', 'A valid AES-256-GCM key with the required usage is needed.');
}

function validateSealedData(sealed) {
  if (!isRecord(sealed) || sealed.version !== 1 || sealed.cipher !== 'AES-256-GCM')
    throw new VaultError('corrupt', 'This encrypted data uses an unsupported format.');
  validateBase64(sealed.iv, IV_BYTES, IV_BYTES);
  validateBase64(sealed.ciphertext, TAG_BYTES, MAX_CIPHERTEXT_BYTES);
}

function validateVaultPayload(vault) {
  if (!isRecord(vault) || vault.version !== 1 || !Array.isArray(vault.entries))
    throw new VaultError('corrupt', 'The decrypted vault payload is invalid.');
  const files = Object.hasOwn(vault, 'files') ? vault.files : [];
  if (!Array.isArray(files))
    throw new VaultError('corrupt', 'The vault file manifest is invalid.');
  for (const file of files) {

    if (!isRecord(file) || typeof file.name !== 'string'
      || !Number.isInteger(file.size) || file.size < 0 || file.size > MAX_VAULT_FILE_BYTES
      || Object.keys(file).some((field) => !['id', 'name', 'size'].includes(field)))
      throw new VaultError('corrupt', 'The vault file manifest contains invalid metadata.');
    canonicalFileId(file.id);
  }
  return { ...vault, files };
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function additionalData(kdf) {
  return `surge-vault-v1|${kdf.algorithm}|${kdf.memoryKiB}|${kdf.iterations}|${kdf.parallelism}|${kdf.salt}`;
}

export function validateEnvelope(envelope) {
  const kdf = envelope?.kdf;
  if (!isRecord(envelope) || !isRecord(kdf) || kdf.algorithm !== 'argon2id')
    throw new VaultError('corrupt', 'This vault file was written by an unsupported version of Surge.');
  validateSealedData(envelope);
  validateBase64(kdf.salt, SALT_BYTES, SALT_BYTES);
  if (!Number.isInteger(kdf.memoryKiB) || kdf.memoryKiB < 8192 || kdf.memoryKiB > 1048576
    || !Number.isInteger(kdf.iterations) || kdf.iterations < 1 || kdf.iterations > 10
    || !Number.isInteger(kdf.parallelism) || kdf.parallelism < 1 || kdf.parallelism > 16)
    throw new VaultError('corrupt', 'This vault file contains unsupported encryption settings.');
  return envelope;
}

async function deriveKey(masterPassword, kdf) {
  if (typeof masterPassword !== 'string')
    throw new VaultError('password', 'The master password must be a string.');
  const argon2id = globalThis.hashwasm?.argon2id;
  if (typeof argon2id !== 'function')
    throw new VaultError('library', 'The encryption library did not load. Restore Interface/vendor/argon2.umd.min.js on the USB drive.');

  const raw = await argon2id({
    password: masterPassword,
    salt: fromBase64(kdf.salt),
    parallelism: kdf.parallelism,
    iterations: kdf.iterations,
    memorySize: kdf.memoryKiB,
    hashLength: KEY_BYTES,
    outputType: 'binary',
  });

  try {
    return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  } finally {
    raw.fill(0);
  }
}

async function seal(key, kdf, vault) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(vault));
  try {
    if (plaintext.byteLength > MAX_VAULT_FILE_BYTES)
      throw new VaultError('too-large', 'The vault manifest exceeds the 16 MiB limit.');
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(additionalData(kdf)), tagLength: 128 },
      key,
      plaintext,
    );
    return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
  } finally {
    plaintext.fill(0);
  }
}

async function unseal(key, envelope) {
  const plaintext = new Uint8Array(await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64(envelope.iv),
      additionalData: new TextEncoder().encode(additionalData(envelope.kdf)),
      tagLength: 128,
    },
    key,
    fromBase64(envelope.ciphertext),
  ));
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
  } catch {
    throw new VaultError('corrupt', 'The decrypted vault payload is invalid.');
  } finally {
    plaintext.fill(0);
  }
}

export async function createVault(masterPassword) {
  const kdf = { ...KDF_DEFAULTS, salt: toBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES))) };
  const key = await deriveKey(masterPassword, kdf);
  const now = new Date().toISOString();
  const sealed = await seal(key, kdf, { version: 1, entries: [], files: [] });
  return { key, envelope: { version: 1, kdf, cipher: 'AES-256-GCM', createdAt: now, updatedAt: now, ...sealed } };
}

export async function unlockVault(envelope, masterPassword) {
  validateEnvelope(envelope);
  const key = await deriveKey(masterPassword, envelope.kdf);
  let vault;
  try {
    vault = await unseal(key, envelope);
  } catch (error) {
    if (error instanceof VaultError) throw error;
    throw new VaultError('wrong-password', 'That master password did not unlock the vault, or the vault file is damaged.');
  }
  return { key, vault: validateVaultPayload(vault) };
}

export async function sealVault(key, envelope, vault) {
  validateKey(key, 'encrypt');
  validateEnvelope(envelope);
  const sealed = await seal(key, envelope.kdf, validateVaultPayload(vault));
  return { ...envelope, ...sealed, updatedAt: new Date().toISOString() };
}

export async function encryptVaultFile(key, envelope, id, bytes) {
  validateKey(key, 'encrypt');
  validateEnvelope(envelope);
  const fileId = canonicalFileId(id);
  if (!(bytes instanceof Uint8Array))
    throw new VaultError('invalid-file', 'File contents must be a Uint8Array.');
  if (bytes.byteLength > MAX_VAULT_FILE_BYTES)
    throw new VaultError('too-large', 'Files must not exceed 16 MiB.');
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  let ciphertext;
  try {

    ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM', iv, tagLength: 128,
        additionalData: new TextEncoder().encode(`surge-vault-file-v1|${envelope.kdf.salt}|${fileId}`),
      },
      key,
      bytes,
    );
  } catch {
    throw new VaultError('encrypt', 'The file could not be encrypted.');
  }
  return { version: 1, cipher: 'AES-256-GCM', iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

export async function decryptVaultFile(key, envelope, id, sealed) {
  validateKey(key, 'decrypt');
  validateEnvelope(envelope);
  const fileId = canonicalFileId(id);
  validateSealedData(sealed);
  if (Object.keys(sealed).some((field) => !['version', 'cipher', 'iv', 'ciphertext'].includes(field)))
    throw new VaultError('corrupt', 'The encrypted file blob contains unsupported fields.');
  try {
    return new Uint8Array(await crypto.subtle.decrypt(
      {
        name: 'AES-GCM', iv: fromBase64(sealed.iv), tagLength: 128,
        additionalData: new TextEncoder().encode(`surge-vault-file-v1|${envelope.kdf.salt}|${fileId}`),
      },
      key,
      fromBase64(sealed.ciphertext),
    ));
  } catch {
    throw new VaultError('decrypt', 'The file could not be decrypted. The key or vault/file identity does not match, or the file is damaged.');
  }
}

export function masterPasswordStrength(password) {
  let score = 0;
  if (password.length >= MIN_MASTER_LENGTH) score += 1;
  if (password.length >= 16) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(score, 5);
}
