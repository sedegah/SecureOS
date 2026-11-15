// Fingerprint / Biometric authentication for Surge Vault.
// In the installed desktop app: Uses native secure storage (DPAPI / Windows Hello).
// In standalone browser preview: Uses WebAuthn Platform Authenticator.

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

let sensorAvailableCache = null;

export async function isFingerprintSensorAvailable() {
  // If running inside the installed Surge desktop app, use native credential hardware
  if (window.surgeDesktop?.biometricIsAvailable) {
    try {
      return await window.surgeDesktop.biometricIsAvailable();
    } catch {
      return false;
    }
  }

  // Standalone browser preview: check WebAuthn
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
  if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') return false;

  if (sensorAvailableCache === null) {
    sensorAvailableCache = PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false);
  }
  return sensorAvailableCache;
}

export function isFingerprintEnrolled() {
  try {
    return Boolean(localStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}

export async function removeFingerprintEnrollment() {
  localStorage.removeItem(STORAGE_KEY);
  if (window.surgeDesktop?.biometricRemove) {
    try {
      await window.surgeDesktop.biometricRemove();
    } catch {}
  }
}

export async function enrollFingerprint(masterPassword) {
  if (!masterPassword || typeof masterPassword !== 'string') {
    throw new Error('Master password is required for enrollment.');
  }

  // 1. Native Desktop App (no ports, no invalid domain, full Windows Hello integration)
  if (window.surgeDesktop?.biometricEnroll) {
    await window.surgeDesktop.biometricEnroll(masterPassword);
    localStorage.setItem(STORAGE_KEY, 'enrolled-desktop');
    return true;
  }

  // 2. Standalone browser preview: WebAuthn
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));

  let credential;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'Surge Vault' },
        user: {
          id: userId,
          name: 'vault-user',
          displayName: 'Surge Vault User',
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          requireResidentKey: false,
        },
        timeout: 60000,
      },
    });
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      throw new Error('Fingerprint sensor prompt was cancelled or timed out.');
    }
    throw new Error(err.message || 'Fingerprint enrollment failed.');
  }

  if (!credential || !credential.rawId) {
    throw new Error('Fingerprint verification was cancelled or failed.');
  }

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
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
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
  // 1. Native Desktop App
  if (window.surgeDesktop?.biometricUnlock) {
    return await window.surgeDesktop.biometricUnlock();
  }

  // 2. Standalone browser preview: WebAuthn
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) throw new Error('No fingerprint enrolled on this system.');
  const record = JSON.parse(raw);

  const credentialId = fromBase64(record.credentialId);
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  let assertion;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [
          { type: 'public-key', id: credentialId, transports: ['internal'] },
        ],
        userVerification: 'required',
        timeout: 60000,
      },
    });
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      throw new Error('Fingerprint verification was cancelled or timed out.');
    }
    throw new Error(err.message || 'Fingerprint verification failed.');
  }

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
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
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

  return new TextDecoder().decode(decryptedBytes);
}
