// Fingerprint / Biometric authentication for Surge Vault using WebAuthn Platform Authenticator.
// Only available and shown if the host system has a platform authenticator (e.g. Windows Hello Fingerprint sensor).

const STORAGE_KEY = 'surge.vault.fingerprint';

function toBase64(bytes) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary);
}

function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let sensorAvailablePromise = null;

export async function isFingerprintSensorAvailable() {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
  if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') return false;

  if (sensorAvailablePromise === null) {
    sensorAvailablePromise = PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false);
  }
  return sensorAvailablePromise;
}

export function isFingerprintEnrolled() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Boolean(parsed?.credentialId && parsed?.encryptedPassword);
  } catch {
    return false;
  }
}

export function removeFingerprintEnrollment() {
  localStorage.removeItem(STORAGE_KEY);
}

export async function enrollFingerprint(masterPassword) {
  if (!masterPassword || typeof masterPassword !== 'string') {
    throw new Error('Master password is required for enrollment.');
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'Surge Vault', id: window.location.hostname },
      user: {
        id: userId,
        name: 'vault-user',
        displayName: 'Surge Vault User',
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },  // ES256
        { alg: -257, type: 'public-key' }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        requireResidentKey: false,
      },
      timeout: 60000,
    },
  });

  if (!credential || !credential.rawId) {
    throw new Error('Fingerprint verification was cancelled or failed.');
  }

  // Derive an encryption key bound to the credential ID and a fresh random salt
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(credential.rawId),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    derivedKey,
    enc.encode(masterPassword)
  );

  const record = {
    credentialId: toBase64(new Uint8Array(credential.rawId)),
    salt: toBase64(salt),
    iv: toBase64(iv),
    encryptedPassword: toBase64(new Uint8Array(encrypted)),
    enrolledAt: new Date().toISOString(),
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  return true;
}

export async function unlockWithFingerprint() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) throw new Error('No fingerprint enrolled on this system.');
  const record = JSON.parse(raw);

  const credentialId = fromBase64(record.credentialId);
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [
        {
          type: 'public-key',
          id: credentialId,
          transports: ['internal'],
        },
      ],
      userVerification: 'required',
      timeout: 60000,
    },
  });

  if (!assertion || !assertion.rawId) {
    throw new Error('Fingerprint verification was cancelled or failed.');
  }

  const salt = fromBase64(record.salt);
  const iv = fromBase64(record.iv);
  const encryptedPassword = fromBase64(record.encryptedPassword);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(assertion.rawId),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const decryptedBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    derivedKey,
    encryptedPassword
  );

  const dec = new TextDecoder();
  return dec.decode(decryptedBytes);
}

