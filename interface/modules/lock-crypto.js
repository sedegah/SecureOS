/**
 * Lock-screen credentials.
 *
 * The workspace lock keeps a small profile document on the drive:
 *
 *   { version: 1, kind: 'surge-lock', name, secured: false }            // no password
 *   { version: 1, kind: 'surge-lock', name, secured: true, kdf, ... }   // password set
 *
 * When a password is set, the profile name is sealed with a key derived from
 * that password using Argon2id, and the name is bound into the AEAD's
 * additional data. A wrong password therefore fails to decrypt rather than
 * being compared against a stored hash, so no password verifier is ever
 * written to the drive.
 *
 * This module is deliberately free of DOM and network access so it can be
 * unit tested under Node.
 */

const KDF_DEFAULTS = { algorithm: 'argon2id', memoryKiB: 65536, iterations: 3, parallelism: 1 };
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export const LOCK_VERSION = 1;
export const LOCK_KIND = 'surge-lock';
export const MIN_LOCK_PASSWORD_LENGTH = 8;
export const MAX_LOCK_PASSWORD_LENGTH = 1024;
export const MAX_LOCK_NAME_LENGTH = 48;
export const MAX_LOCK_PAYLOAD_BYTES = 4096;
const MAX_CIPHERTEXT_BYTES = MAX_LOCK_PAYLOAD_BYTES + TAG_BYTES;

const DOCUMENT_FIELDS = [
  'version', 'kind', 'name', 'secured',
  'kdf', 'cipher', 'iv', 'ciphertext',
  'createdAt', 'updatedAt',
];

export class LockError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toBase64(bytes) {
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 0x6000) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 0x6000))));
  }
  return chunks.join('');
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function validateBase64(text, minBytes, maxBytes) {
  if (typeof text !== 'string' || text.length % 4 !== 0
    || text.length < 4 * Math.ceil(minBytes / 3) || text.length > 4 * Math.ceil(maxBytes / 3))
    throw new LockError('corrupt', 'The lock screen data on this drive has an invalid length.');

  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const byteLength = text.length / 4 * 3 - padding;
  if (byteLength < minBytes || byteLength > maxBytes
    || /[^A-Za-z0-9+/]/.test(text.slice(0, text.length - padding))
    || (padding && (BASE64_ALPHABET.indexOf(text[text.length - padding - 1]) & (padding === 2 ? 15 : 3))))
    throw new LockError('corrupt', 'The lock screen data on this drive is not valid.');
}

/** Trims and validates a display name. */
export function normalizeProfileName(raw) {
  if (typeof raw !== 'string')
    throw new LockError('invalid-name', 'Enter a name for this profile.');
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) throw new LockError('invalid-name', 'Enter a name for this profile.');
  if (name.length > MAX_LOCK_NAME_LENGTH)
    throw new LockError('invalid-name', `Keep the name to ${MAX_LOCK_NAME_LENGTH} characters or fewer.`);
  if (/[\u0000-\u001f\u007f|]/.test(name))
    throw new LockError('invalid-name', 'The name contains characters that cannot be saved.');
  return name;
}

function validatePassword(password) {
  if (typeof password !== 'string')
    throw new LockError('invalid-password', 'Enter a password.');
  if (password.length < MIN_LOCK_PASSWORD_LENGTH)
    throw new LockError('invalid-password', `Use at least ${MIN_LOCK_PASSWORD_LENGTH} characters.`);
  if (password.length > MAX_LOCK_PASSWORD_LENGTH)
    throw new LockError('invalid-password', 'That password is too long.');
}

function additionalData(name, kdf) {
  return `surge-lock-v1|${name}|${kdf.algorithm}|${kdf.memoryKiB}|${kdf.iterations}|${kdf.parallelism}|${kdf.salt}`;
}

function validateSealedData(document) {
  if (document.cipher !== 'AES-256-GCM')
    throw new LockError('corrupt', 'This lock screen was written by an unsupported version of Surge.');
  validateBase64(document.iv, IV_BYTES, IV_BYTES);
  validateBase64(document.ciphertext, TAG_BYTES, MAX_CIPHERTEXT_BYTES);
}

/**
 * Validates a stored lock document and returns a normalized view of it.
 * Throws LockError('corrupt', ...) when the document cannot be trusted.
 */
export function validateLockDocument(document) {
  if (!isRecord(document))
    throw new LockError('corrupt', 'The lock screen data on this drive is not readable.');
  if (document.version !== LOCK_VERSION || document.kind !== LOCK_KIND)
    throw new LockError('corrupt', 'This lock screen was written by an unsupported version of Surge.');
  if (Object.keys(document).some((field) => !DOCUMENT_FIELDS.includes(field)))
    throw new LockError('corrupt', 'The lock screen data contains unsupported fields.');

  const name = normalizeProfileName(document.name ?? '');
  if (typeof document.secured !== 'boolean')
    throw new LockError('corrupt', 'The lock screen data is missing its security state.');

  if (!document.secured) {
    if (document.kdf !== undefined || document.iv !== undefined || document.ciphertext !== undefined)
      throw new LockError('corrupt', 'A password-free profile must not contain encrypted data.');
    return { name, secured: false };
  }

  const kdf = document.kdf;
  if (!isRecord(kdf) || kdf.algorithm !== 'argon2id')
    throw new LockError('corrupt', 'This lock screen uses an unsupported password derivation.');
  validateBase64(kdf.salt, SALT_BYTES, SALT_BYTES);
  if (!Number.isInteger(kdf.memoryKiB) || kdf.memoryKiB < 8192 || kdf.memoryKiB > 1048576
    || !Number.isInteger(kdf.iterations) || kdf.iterations < 1 || kdf.iterations > 10
    || !Number.isInteger(kdf.parallelism) || kdf.parallelism < 1 || kdf.parallelism > 16)
    throw new LockError('corrupt', 'This lock screen contains unsupported encryption settings.');
  validateSealedData(document);

  return { name, secured: true, kdf };
}

async function deriveKey(password, kdf) {
  const argon2id = globalThis.hashwasm?.argon2id;
  if (typeof argon2id !== 'function')
    throw new LockError('library', 'The encryption library did not load. Restore Interface/vendor/argon2.umd.min.js on the drive.');

  const raw = await argon2id({
    password,
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

async function seal(key, name, kdf) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify({ version: LOCK_VERSION, kind: LOCK_KIND, name }));
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(additionalData(name, kdf)), tagLength: 128 },
      key,
      plaintext,
    );
    return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
  } finally {
    plaintext.fill(0);
  }
}

/** Creates a password-protected profile document. */
export async function createSecuredLockDocument(rawName, password) {
  const name = normalizeProfileName(rawName);
  validatePassword(password);

  const kdf = { ...KDF_DEFAULTS, salt: toBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES))) };
  const key = await deriveKey(password, kdf);
  const sealed = await seal(key, name, kdf);
  const now = new Date().toISOString();

  return {
    key,
    document: {
      version: LOCK_VERSION,
      kind: LOCK_KIND,
      name,
      secured: true,
      kdf,
      cipher: 'AES-256-GCM',
      createdAt: now,
      updatedAt: now,
      ...sealed,
    },
  };
}

/** Creates a profile without a password: the workspace opens straight away. */
export function createOpenLockDocument(rawName) {
  const name = normalizeProfileName(rawName);
  const now = new Date().toISOString();
  return { version: LOCK_VERSION, kind: LOCK_KIND, name, secured: false, createdAt: now, updatedAt: now };
}

/**
 * Re-seals an existing profile under a new password (or for a renamed profile)
 * without changing its identity elsewhere.
 */
export async function resealLockDocument(document, rawName, password) {
  validateLockDocument(document);
  const name = normalizeProfileName(rawName);
  validatePassword(password);

  const kdf = { ...KDF_DEFAULTS, salt: toBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES))) };
  const key = await deriveKey(password, kdf);
  const sealed = await seal(key, name, kdf);

  return {
    key,
    document: {
      version: LOCK_VERSION,
      kind: LOCK_KIND,
      name,
      secured: true,
      kdf,
      cipher: 'AES-256-GCM',
      createdAt: document.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...sealed,
    },
  };
}

/** Re-seals with an already-derived key (used to rename an unlocked profile). */
export async function resealWithKey(document, key, rawName) {
  validateLockDocument(document);
  if (!document.secured) throw new LockError('insecure', 'This profile has no password.');
  if (!(key instanceof CryptoKey)) throw new LockError('locked', 'Unlock the workspace before renaming this profile.');

  const name = normalizeProfileName(rawName);
  const sealed = await seal(key, name, document.kdf);
  return { ...document, name, updatedAt: new Date().toISOString(), ...sealed };
}

/**
 * Verifies a password against a stored profile document.
 * Returns the decrypted profile name and the derived key on success.
 */
export async function unlockLockDocument(document, password) {
  const { name: storedName, secured, kdf } = validateLockDocument(document);
  if (!secured) return { name: storedName, key: null };
  validatePassword(password);

  const key = await deriveKey(password, kdf);
  let payload;
  try {
    const plaintext = new Uint8Array(await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64(document.iv),
        additionalData: new TextEncoder().encode(additionalData(storedName, kdf)),
        tagLength: 128,
      },
      key,
      fromBase64(document.ciphertext),
    ));
    try {
      payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
    } finally {
      plaintext.fill(0);
    }
  } catch {
    throw new LockError('wrong-password', 'That password did not unlock this workspace.');
  }

  if (!isRecord(payload) || payload.version !== LOCK_VERSION || payload.kind !== LOCK_KIND
    || payload.name !== storedName)
    throw new LockError('corrupt', 'The lock screen data on this drive does not match its profile.');

  return { name: payload.name, key };
}
