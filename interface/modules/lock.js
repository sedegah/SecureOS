import { api } from './api.js';
import { h, clear, toast, confirmDialog } from './ui.js';
import { masterPasswordStrength } from './vault-crypto.js';
import {
  LockError, createOpenLockDocument, createSecuredLockDocument, normalizeProfileName,
  resealLockDocument, resealWithKey, unlockLockDocument, validateLockDocument,
  MIN_LOCK_PASSWORD_LENGTH, MAX_LOCK_NAME_LENGTH,
} from './lock-crypto.js';

const DOCUMENT = 'lock';
const MAX_ATTEMPTS_BEFORE_DELAY = 3;
const MAX_DELAY_MS = 30000;

const state = {
  loaded: false,
  document: null,
  name: '',
  secured: false,
  unlocked: false,
  key: null,
  corrupt: false,
};

let gatePromise = null;
let delayTimer = null;

export function getProfile() {
  return { name: state.name, secured: state.secured, unlocked: state.unlocked };
}

export function isWorkspaceLocked() {
  return state.secured && !state.unlocked;
}

/** Reads the stored profile. A missing document means Surge was never set up. */
export async function loadProfile() {
  state.corrupt = false;
  let stored = null;
  try {
    stored = await api.readDocument(DOCUMENT);
  } catch (error) {
    if (error?.status !== 404) throw error;
  }

  if (!stored) {
    state.loaded = true;
    state.document = null;
    state.name = '';
    state.secured = false;
    state.unlocked = true;
    state.key = null;
    return getProfile();
  }

  try {
    const { name, secured } = validateLockDocument(stored);
    state.document = stored;
    state.name = name;
    state.secured = secured;
    state.unlocked = !secured;
    state.key = null;
  } catch (error) {
    // A damaged profile must not silently drop the lock: surface it and let
    // the drive owner set the profile up again, keeping the vault untouched.
    state.corrupt = true;
    state.document = null;
    state.name = '';
    state.secured = false;
    state.unlocked = false;
    state.key = null;
  }

  state.loaded = true;
  return getProfile();
}

async function persist(document) {
  await api.writeDocument(DOCUMENT, document);
  state.document = document;
  const { name, secured } = validateLockDocument(document);
  state.name = name;
  state.secured = secured;
  state.loaded = true;
}

/** Creates the profile on first run. Without a password the workspace opens freely. */
export async function createProfile({ name, password }) {
  if (!password) {
    const document = createOpenLockDocument(name);
    await persist(document);
    state.unlocked = true;
    state.key = null;
    return getProfile();
  }

  const { document, key } = await createSecuredLockDocument(name, password);
  await persist(document);
  state.key = key;
  state.unlocked = true;
  return getProfile();
}

export async function unlockWorkspace(password) {
  if (!state.document) throw new LockError('not-configured', 'This drive has no profile yet.');
  const { name, key } = await unlockLockDocument(state.document, password);
  state.name = name;
  state.unlocked = true;
  state.key = key;
  return getProfile();
}

/** Adds a password to a profile that does not have one. */
export async function addPassword(password) {
  if (state.secured) throw new LockError('already-secured', 'This profile already has a password.');
  const name = normalizeProfileName(state.name);
  const { document, key } = await createSecuredLockDocument(name, password);
  await persist(document);
  state.key = key;
  state.unlocked = true;
  return getProfile();
}

export async function changePassword(currentPassword, newPassword) {
  if (!state.document || !state.secured) throw new LockError('not-configured', 'This profile has no password to change.');
  await unlockLockDocument(state.document, currentPassword);
  const { document, key } = await resealLockDocument(state.document, state.name, newPassword);
  await persist(document);
  state.key = key;
  state.unlocked = true;
  return getProfile();
}

export async function removePassword(currentPassword) {
  if (!state.document || !state.secured) throw new LockError('not-configured', 'This profile has no password.');
  await unlockLockDocument(state.document, currentPassword);
  const document = createOpenLockDocument(state.name);
  await persist(document);
  state.key = null;
  state.unlocked = true;
  return getProfile();
}

export async function renameProfile(name) {
  if (!state.document) throw new LockError('not-configured', 'This drive has no profile yet.');
  const clean = normalizeProfileName(name);
  if (!state.secured) {
    const document = { ...state.document, name: clean, updatedAt: new Date().toISOString() };
    await persist(document);
    return getProfile();
  }
  if (!state.key) throw new LockError('locked', 'Unlock the workspace before renaming this profile.');
  const document = await resealWithKey(state.document, state.key, clean);
  await persist(document);
  return getProfile();
}

/** Drops the derived key; used when the workspace is locked again or unloaded. */
export function forgetKey() {
  state.key = null;
  state.unlocked = !state.secured;
}

/**
 * Presents the gate and resolves once the workspace may be shown.
 * Never shown when the profile has no password, or before one is set up.
 */
export function guardWorkspace() {
  if (gatePromise) return gatePromise;

  gatePromise = (async () => {
    if (!state.loaded) await loadProfile();
    if (state.secured && !state.unlocked) await renderUnlockGate();
    else if (!state.document || state.corrupt) await renderSetupGate();
  })().finally(() => {
    gatePromise = null;
  });

  return gatePromise;
}

/** Locks the workspace again and shows the gate (used by Settings). */
export async function lockWorkspace() {
  if (!state.secured) {
    toast('This profile has no password, so there is nothing to lock.', 'warn');
    return;
  }
  state.unlocked = false;
  state.key = null;
  await guardWorkspace();
}

/** Lets the drive owner past a forgotten password, at the cost of the lock. */
async function removeLockAfterConfirmation() {
  const confirmed = await confirmDialog({
    title: 'Forgot your password?',
    message: 'Surge can remove the lock screen from this drive so you can set a new profile. Your files and the password vault stay encrypted and untouched. Anyone holding this drive could then open the Surge workspace.',
    confirmLabel: 'Remove the lock',
    danger: true,
  });
  if (!confirmed) return false;

  const name = state.name || 'User';
  const document = createOpenLockDocument(name);
  await persist(document);
  state.unlocked = true;
  state.key = null;
  return true;
}

// ----------------------------------------------------------------- UI pieces

function initialsFor(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function brandMark() {
  return h('div', { class: 'lock-brand' },
    h('img', { class: 'lock-logo', src: 'assets/surge.png', alt: '' }),
    h('div', { class: 'lock-brand-text' },
      h('span', { class: 'lock-brand-name', text: 'Surge' }),
      h('span', { class: 'lock-brand-sub', text: 'Workspace & Browser' })));
}

function passwordStrengthMeter(input) {
  const bars = h('div', { class: 'lock-strength', 'aria-hidden': 'true' },
    [0, 1, 2, 3, 4].map(() => h('span', { class: 'lock-strength-bar' })));
  const label = h('span', { class: 'lock-strength-label', text: '' });

  const update = () => {
    const score = input.value ? masterPasswordStrength(input.value) : 0;
    const bars_ = [...bars.children];
    bars_.forEach((bar, index) => bar.classList.toggle('on', index < score));
    label.textContent = !input.value ? ''
      : score <= 1 ? 'Weak'
      : score === 2 ? 'Fair'
      : score === 3 ? 'Good'
      : score === 4 ? 'Strong'
      : 'Very strong';
  };

  input.addEventListener('input', update);
  return { element: h('div', { class: 'lock-strength-row' }, bars, label), update };
}

function promptButton(label, kind = 'primary') {
  return h('button', {
    type: 'submit',
    class: kind === 'primary' ? 'btn btn-primary lock-submit' : 'btn lock-submit',
  }, label);
}

function field(id, label, { type = 'text', autocomplete = 'off', maxlength = null, placeholder = '' } = {}) {
  return h('label', { class: 'field lock-field', for: id },
    h('span', { class: 'field-label', text: label }),
    h('input', {
      class: 'input lock-input',
      id,
      type,
      placeholder,
      autocomplete,
      spellcheck: 'false',
      autocapitalize: 'off',
      maxlength,
    }));
}

function showGate(root) {
  document.body.classList.add('is-locked');
  document.body.append(root);
  return root;
}

function hideGate(root) {
  root.remove();
  document.body.classList.remove('is-locked');
  if (delayTimer) { clearInterval(delayTimer); delayTimer = null; }
  document.getElementById('main')?.focus?.();
}

function renderSetupGate() {
  return new Promise((resolve) => {
    const corrupt = state.corrupt;
    const nameInput = h('input', {
      class: 'input lock-input', id: 'lock-name', type: 'text', autocomplete: 'off',
      spellcheck: 'false', maxlength: MAX_LOCK_NAME_LENGTH, placeholder: 'e.g. Ada',
    });
    const passwordInput = h('input', {
      class: 'input lock-input', id: 'lock-password', type: 'password',
      autocomplete: 'new-password', maxlength: 1024,
    });
    const confirmInput = h('input', {
      class: 'input lock-input', id: 'lock-confirm', type: 'password',
      autocomplete: 'new-password', maxlength: 1024,
    });

    const avatar = h('div', { class: 'lock-avatar', 'aria-hidden': 'true', text: '?' });
    nameInput.addEventListener('input', () => { avatar.textContent = initialsFor(nameInput.value); });

    const strength = passwordStrengthMeter(passwordInput);
    const error = h('p', { class: 'lock-error', role: 'alert', 'aria-live': 'polite' });
    const submit = promptButton('Create profile');
    const skip = h('button', { class: 'btn lock-skip', type: 'button' }, 'Continue without a password');

    const form = h('form', { class: 'lock-form', novalidate: true },
      h('div', { class: 'lock-identity' }, avatar, h('div', {},
        h('h2', { class: 'lock-title', id: 'lock-title', text: 'Set up this drive' }),
        h('p', { class: 'lock-sub', text: 'Your name greets you on the lock screen. The password locks the workspace when Surge opens.' }))),
      h('label', { class: 'field lock-field', for: 'lock-name' },
        h('span', { class: 'field-label', text: 'Your name' }), nameInput),
      h('label', { class: 'field lock-field', for: 'lock-password' },
        h('span', { class: 'field-label', text: 'Password' }), passwordInput, strength.element),
      h('label', { class: 'field lock-field', for: 'lock-confirm' },
        h('span', { class: 'field-label', text: 'Confirm password' }), confirmInput),
      error,
      h('div', { class: 'lock-actions' }, submit, skip));

    const root = h('div', { class: 'lock-root', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'lock-title' },
      h('div', { class: 'lock-card' },
        brandMark(),
        corrupt ? h('div', { class: 'banner banner-warn lock-banner' },
          h('div', {}, h('strong', { text: 'The lock file was damaged' }),
            h('p', { text: 'Surge could not read the saved profile, so it was not used. Set the profile up again — your files and vault are untouched.' }))) : null,
        form,
        h('p', { class: 'lock-foot', text: 'The password is stored as an Argon2id hash and cannot be recovered. You can change it later in Settings.' })));

    const finish = () => { hideGate(root); resolve(); };

    const submitProfile = async ({ withPassword }) => {
      error.textContent = '';
      const name = nameInput.value;
      try {
        if (!withPassword) {
          await createProfile({ name: name.trim() || 'User', password: '' });
          finish();
          return;
        }
        if (passwordInput.value !== confirmInput.value) {
          error.textContent = 'The two passwords do not match.';
          confirmInput.focus();
          return;
        }
        submit.disabled = true;
        submit.textContent = 'Creating…';
        await createProfile({ name, password: passwordInput.value });
        finish();
      } catch (failure) {
        submit.disabled = false;
        submit.textContent = 'Create profile';
        error.textContent = failure?.code === 'library'
          ? `${failure.message} You can still continue without a password.`
          : (failure?.message ?? 'That profile could not be created.');
      } finally {
        passwordInput.value = '';
        confirmInput.value = '';
        strength.update();
      }
    };

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void submitProfile({ withPassword: true });
    });
    skip.addEventListener('click', () => { void submitProfile({ withPassword: false }); });

    showGate(root);
    nameInput.focus();
  });
}

function renderUnlockGate() {
  return new Promise((resolve) => {
    let failures = 0;
    let busy = false;

    const avatar = h('div', { class: 'lock-avatar', 'aria-hidden': 'true', text: initialsFor(state.name) });
    const nameHeading = h('h2', { class: 'lock-title', id: 'lock-title', text: state.name || 'User' });
    const passwordInput = h('input', {
      class: 'input lock-input', id: 'lock-password', type: 'password',
      autocomplete: 'current-password', maxlength: 1024,
    });
    const error = h('p', { class: 'lock-error', role: 'alert', 'aria-live': 'polite' });
    const submit = promptButton('Unlock');
    const forgot = h('button', { class: 'btn lock-skip', type: 'button' }, 'Forgot password?');

    const form = h('form', { class: 'lock-form', novalidate: true },
      h('div', { class: 'lock-identity' }, avatar, h('div', {},
        nameHeading,
        h('p', { class: 'lock-sub', text: 'Enter your password to open this workspace.' }))),
      h('label', { class: 'field lock-field', for: 'lock-password' },
        h('span', { class: 'field-label', text: 'Password' }), passwordInput),
      error,
      h('div', { class: 'lock-actions' }, submit, forgot));

    const root = h('div', { class: 'lock-root', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'lock-title' },
      h('div', { class: 'lock-card' },
        brandMark(),
        form,
        h('p', { class: 'lock-foot', text: 'Surge keeps this workspace on your drive. The password is never stored in readable form.' })));

    const finish = () => { hideGate(root); resolve(); };

    const startDelay = (seconds) => {
      let remaining = seconds;
      const tick = () => {
        if (remaining <= 0) {
          clearInterval(delayTimer);
          delayTimer = null;
          submit.disabled = false;
          passwordInput.disabled = false;
          error.textContent = '';
          passwordInput.focus();
          return;
        }
        submit.disabled = true;
        passwordInput.disabled = true;
        error.textContent = `Too many attempts. Try again in ${remaining} second${remaining === 1 ? '' : 's'}.`;
        remaining -= 1;
      };
      tick();
      delayTimer = setInterval(tick, 1000);
    };

    const attempt = async () => {
      if (busy || delayTimer) return;
      const password = passwordInput.value;
      if (!password) { error.textContent = 'Enter your password.'; passwordInput.focus(); return; }

      busy = true;
      submit.disabled = true;
      submit.textContent = 'Unlocking…';
      error.textContent = '';
      root.classList.add('lock-busy');
      try {
        await unlockWorkspace(password);
        finish();
      } catch (failure) {
        passwordInput.value = '';
        failures += 1;
        error.textContent = failure?.code === 'wrong-password'
          ? 'That password is not right.'
          : (failure?.message ?? 'The workspace could not be unlocked.');
        root.classList.remove('lock-shake');
        void root.offsetWidth;
        root.classList.add('lock-shake');
        if (failure?.code === 'wrong-password' && failures >= MAX_ATTEMPTS_BEFORE_DELAY) {
          startDelay(Math.min(30, 2 ** (failures - MAX_ATTEMPTS_BEFORE_DELAY + 2)));
        } else {
          passwordInput.focus();
        }
      } finally {
        busy = false;
        root.classList.remove('lock-busy');
        submit.textContent = 'Unlock';
        submit.disabled = Boolean(delayTimer);
      }
    };

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void attempt();
    });
    forgot.addEventListener('click', async () => {
      try {
        if (await removeLockAfterConfirmation()) finish();
      } catch (failure) {
        error.textContent = failure?.message ?? 'The lock could not be removed.';
      }
    });

    showGate(root);
    passwordInput.focus();
  });
}
