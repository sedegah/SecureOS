// Argon2id comes from the vendored hash-wasm UMD bundle loaded by index.html (globalThis.hashwasm).
// AES-256-GCM uses the browser's own WebCrypto implementation. The master password and the derived
// key never leave this page: only the sealed envelope is handed to the USB helper.

const KDF_DEFAULTS = { algorithm: 'argon2id', memoryKiB: 65536, iterations: 3, parallelism: 1 };
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;

export const MIN_MASTER_LENGTH = 12;

export class VaultError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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
  if (envelope?.version !== 1 || envelope?.cipher !== 'AES-256-GCM' || kdf?.algorithm !== 'argon2id')
    throw new VaultError('corrupt', 'This vault file was written by an unsupported version of Surge.');
  if (typeof kdf.salt !== 'string' || typeof envelope.iv !== 'string' || typeof envelope.ciphertext !== 'string')
    throw new VaultError('corrupt', 'This vault file is damaged.');
  if (!Number.isInteger(kdf.memoryKiB) || kdf.memoryKiB < 8192 || kdf.memoryKiB > 1048576
    || !Number.isInteger(kdf.iterations) || kdf.iterations < 1 || kdf.iterations > 10
    || !Number.isInteger(kdf.parallelism) || kdf.parallelism < 1 || kdf.parallelism > 16)
    throw new VaultError('corrupt', 'This vault file contains unsupported encryption settings.');
  return envelope;
}

async function deriveKey(masterPassword, kdf) {
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
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(additionalData(kdf)), tagLength: 128 },
    key,
    plaintext,
  );
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

async function unseal(key, envelope) {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64(envelope.iv),
      additionalData: new TextEncoder().encode(additionalData(envelope.kdf)),
      tagLength: 128,
    },
    key,
    fromBase64(envelope.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

export async function createVault(masterPassword) {
  const kdf = { ...KDF_DEFAULTS, salt: toBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES))) };
  const key = await deriveKey(masterPassword, kdf);
  const now = new Date().toISOString();
  const sealed = await seal(key, kdf, { version: 1, entries: [] });
  return { key, envelope: { version: 1, kdf, cipher: 'AES-256-GCM', createdAt: now, updatedAt: now, ...sealed } };
}

export async function unlockVault(envelope, masterPassword) {
  validateEnvelope(envelope);
  const key = await deriveKey(masterPassword, envelope.kdf);
  try {
    const vault = await unseal(key, envelope);
    if (!Array.isArray(vault?.entries)) throw new Error('bad payload');
    return { key, vault };
  } catch {
    throw new VaultError('wrong-password', 'That master password did not unlock the vault, or the vault file is damaged.');
  }
}

export async function sealVault(key, envelope, vault) {
  const sealed = await seal(key, envelope.kdf, vault);
  return { ...envelope, ...sealed, updatedAt: new Date().toISOString() };
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