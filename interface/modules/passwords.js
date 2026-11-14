import { api, bus } from './api.js';
import { h, clear, toast, reportError, confirmDialog, formDialog, emptyState, formatDate } from './ui.js';
import { icon } from './icons.js';
import { getSettings } from './settings.js';
import { createVault, unlockVault, sealVault, masterPasswordStrength, MIN_MASTER_LENGTH, VaultError } from './vault-crypto.js';

let container = null;
let state = 'unknown';
let envelope = null;
let key = null;
let entries = [];
let query = '';
let errorMessage = '';
let revealed = new Set();
let lastActivity = Date.now();
let clipboardTimer = null;
let lockTicker = null;
let activityBound = false;

function lockMinutes() {
  return Math.max(1, Number(getSettings().vaultLockMinutes) || 5);
}

function bindActivity() {
  if (activityBound) return;
  activityBound = true;
  for (const event of ['pointerdown', 'keydown', 'wheel']) {
    document.addEventListener(event, () => { lastActivity = Date.now(); }, { passive: true, capture: true });
  }
  lockTicker = setInterval(() => {
    if (state !== 'unlocked') return;
    if (Date.now() - lastActivity > lockMinutes() * 60000) {
      lock();
      toast('Vault locked after inactivity.');
    } else if (container?.isConnected) {
      updateLockCountdown();
    }
  }, 15000);
  bus.addEventListener('settings-changed', () => { lastActivity = Date.now(); });
}

export function lock() {
  key = null;
  entries = [];
  revealed = new Set();
  void clearClipboard();
  state = envelope ? 'locked' : 'no-vault';
  errorMessage = '';
  if (container?.isConnected) render();
}

export function isUnlocked() {
  return state === 'unlocked';
}

async function persist() {
  envelope = await sealVault(key, envelope, { version: 1, entries });
  await api.writeVault(envelope);
}

async function loadVault() {
  try {
    envelope = await api.readVault();
    state = envelope ? 'locked' : 'no-vault';
  } catch (error) {
    envelope = null;
    state = 'corrupt';
    errorMessage = error.message;
  }
}

async function clearClipboard() {
  clearTimeout(clipboardTimer);
  clipboardTimer = null;
  try {
    await navigator.clipboard.writeText('');
  } catch {
    // Clipboard access can be refused by the browser; nothing sensitive is stored by Surge.
  }
}

async function copySecret(value, label) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    toast('Firefox blocked clipboard access. Use the show button and copy manually.', 'error');
    return;
  }
  const seconds = Math.max(5, Number(getSettings().clipboardClearSeconds) || 20);
  toast(`${label} copied. Clipboard clears in ${seconds}s.`);
  clearTimeout(clipboardTimer);
  clipboardTimer = setTimeout(() => { void clearClipboard(); }, seconds * 1000);
}

function strengthMeter(password) {
  const score = masterPasswordStrength(password);
  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent'];
  return h('div', { class: 'strength' },
    h('div', { class: 'strength-bars', 'aria-hidden': 'true' },
      [1, 2, 3, 4, 5].map((step) => h('span', { class: step <= score ? `strength-bar filled level-${score}` : 'strength-bar' }))),
    h('span', { class: 'strength-label', text: labels[score] }));
}

function createView() {
  const master = h('input', { class: 'input', type: 'password', id: 'master-new', autocomplete: 'new-password', spellcheck: 'false' });
  const confirm = h('input', { class: 'input', type: 'password', id: 'master-confirm', autocomplete: 'new-password', spellcheck: 'false' });
  const meter = h('div', { class: 'strength-holder' }, strengthMeter(''));
  const understood = h('input', { type: 'checkbox', id: 'master-understood' });
  const feedback = h('p', { class: 'form-error', role: 'alert' });

  master.addEventListener('input', () => clear(meter).append(strengthMeter(master.value)));

  const submit = h('button', { class: 'btn btn-primary', type: 'button' }, icon('passwords'), 'Create encrypted vault');
  submit.addEventListener('click', async () => {
    feedback.textContent = '';
    if (master.value.length < MIN_MASTER_LENGTH) {
      feedback.textContent = `Use at least ${MIN_MASTER_LENGTH} characters for the master password.`;
      master.focus();
      return;
    }
    if (master.value !== confirm.value) {
      feedback.textContent = 'The two master passwords do not match.';
      confirm.focus();
      return;
    }
    if (!understood.checked) {
      feedback.textContent = 'Confirm that you understand the master password cannot be recovered.';
      understood.focus();
      return;
    }

    const password = master.value;
    master.value = '';
    confirm.value = '';
    state = 'busy';
    render();
    try {
      const created = await createVault(password);
      await api.writeVault(created.envelope);
      envelope = created.envelope;
      key = created.key;
      entries = [];
      state = 'unlocked';
      lastActivity = Date.now();
      toast('Vault created and encrypted on the USB drive.');
    } catch (error) {
      state = 'no-vault';
      errorMessage = error.message;
      reportError(error);
    }
    render();
  });

  return h('div', { class: 'card vault-card' },
    h('h2', { class: 'card-title', text: 'Create your password vault' }),
    h('p', { text: 'The vault is encrypted on this USB drive with AES-256-GCM. The key is derived from your master password with Argon2id. Surge never stores the master password, and nothing is sent to any cloud service.' }),
    h('div', { class: 'banner banner-warn' }, icon('warning'),
      h('div', {},
        h('strong', { text: 'There is no recovery' }),
        h('p', { text: 'If you forget the master password, the vault cannot be opened again. There is no reset, no hint and no recovery key. Write it down and keep it somewhere safe, away from this USB drive.' }))),
    h('label', { class: 'field', for: 'master-new' }, h('span', { class: 'field-label', text: `Master password (minimum ${MIN_MASTER_LENGTH} characters)` }), master),
    meter,
    h('label', { class: 'field', for: 'master-confirm' }, h('span', { class: 'field-label', text: 'Repeat master password' }), confirm),
    h('label', { class: 'checkbox', for: 'master-understood' }, understood, h('span', { text: 'I understand that a forgotten master password cannot be recovered.' })),
    feedback,
    h('div', { class: 'dialog-actions' }, submit));
}

function lockedView() {
  const master = h('input', { class: 'input', type: 'password', id: 'master-unlock', autocomplete: 'current-password', spellcheck: 'false' });
  const feedback = h('p', { class: 'form-error', role: 'alert', text: errorMessage });
  const submit = h('button', { class: 'btn btn-primary', type: 'button' }, icon('lockOpen'), 'Unlock vault');

  const attempt = async () => {
    const password = master.value;
    master.value = '';
    if (!password) {
      feedback.textContent = 'Enter your master password.';
      master.focus();
      return;
    }
    state = 'busy';
    errorMessage = '';
    render();
    try {
      const opened = await unlockVault(envelope, password);
      key = opened.key;
      entries = opened.vault.entries;
      state = 'unlocked';
      lastActivity = Date.now();
    } catch (error) {
      state = 'locked';
      errorMessage = error instanceof VaultError ? error.message : 'The vault could not be unlocked.';
    }
    render();
    if (state === 'locked') container.querySelector('#master-unlock')?.focus();
  };

  submit.addEventListener('click', attempt);
  master.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); void attempt(); }
  });

  return h('div', { class: 'card vault-card' },
    h('h2', { class: 'card-title', text: 'Vault locked' }),
    h('p', { text: 'Enter your master password to decrypt the vault on this USB drive. Unlocking derives a key with Argon2id, which takes a moment.' }),
    h('label', { class: 'field', for: 'master-unlock' }, h('span', { class: 'field-label', text: 'Master password' }), master),
    feedback,
    h('div', { class: 'dialog-actions' }, submit),
    h('p', { class: 'hint', text: envelope?.updatedAt ? `Vault last saved ${formatDate(envelope.updatedAt)}.` : '' }));
}

function busyView() {
  return h('div', { class: 'card vault-card' },
    h('h2', { class: 'card-title', text: 'Working…' }),
    h('p', { text: 'Deriving the encryption key with Argon2id. This deliberately takes a moment to slow down password guessing.' }));
}

function corruptView() {
  return h('div', { class: 'card vault-card' },
    h('h2', { class: 'card-title', text: 'Vault file damaged' }),
    h('div', { class: 'banner banner-error', role: 'alert' }, icon('warning'),
      h('div', {}, h('strong', { text: 'Surge will not overwrite this vault' }), h('p', { text: errorMessage }))),
    h('p', { text: 'Restore Data/PasswordVault/vault.enc (or its .bak copy) from your own backup, then reopen this page. Creating a new vault here would destroy the existing entries.' }));
}

async function editEntry(entry = null) {
  const values = await formDialog({
    title: entry ? 'Edit password' : 'Add password',
    confirmLabel: entry ? 'Save' : 'Add',
    fields: [
      { name: 'title', label: 'Name', value: entry?.title ?? '', required: true, placeholder: 'Email account' },
      { name: 'username', label: 'Username', value: entry?.username ?? '' },
      { name: 'password', label: 'Password', type: 'password', value: entry?.password ?? '', required: true },
      { name: 'url', label: 'Website', value: entry?.url ?? '', placeholder: 'https://example.org' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 3, value: entry?.notes ?? '' },
    ],
  });
  if (!values) return;

  const now = new Date().toISOString();
  if (entry) Object.assign(entry, values, { modifiedAt: now });
  else entries.push({ id: crypto.randomUUID(), ...values, createdAt: now, modifiedAt: now });

  try {
    await persist();
    toast(entry ? 'Password updated.' : 'Password added.');
    render();
  } catch (error) {
    reportError(error);
  }
}

async function removeEntry(entry) {
  const ok = await confirmDialog({
    title: 'Delete password?',
    message: `"${entry.title}" will be removed from the encrypted vault. This cannot be undone.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  entries = entries.filter((item) => item.id !== entry.id);
  revealed.delete(entry.id);
  try {
    await persist();
    toast('Password deleted.');
    render();
  } catch (error) {
    reportError(error);
  }
}

function updateLockCountdown() {
  const node = container?.querySelector('#lock-countdown');
  if (!node) return;
  const remaining = Math.max(0, lockMinutes() * 60000 - (Date.now() - lastActivity));
  node.textContent = `Auto-lock in ${Math.ceil(remaining / 60000)} min`;
}

function vaultMatches() {
  const needle = query.trim().toLowerCase();
  return entries
    .filter((entry) => !needle || [entry.title, entry.username, entry.url].some((field) => (field ?? '').toLowerCase().includes(needle)))
    .sort((a, b) => a.title.localeCompare(b.title));
}

function vaultRow(entry) {
  const shown = revealed.has(entry.id);
  return h('tr', { class: 'row' },
    h('td', { class: 'cell-name' }, icon('passwords', 16), h('span', { text: entry.title })),
    h('td', { text: entry.username || '—' }),
    h('td', { class: 'cell-secret' },
      h('code', { text: shown ? entry.password : '••••••••••' }),
      h('button', {
        class: 'btn btn-icon', type: 'button', 'aria-label': shown ? 'Hide password' : 'Show password',
        dataset: { reveal: entry.id },
        onClick: () => {
          if (shown) revealed.delete(entry.id); else revealed.add(entry.id);
          renderVaultRows();
          container.querySelector(`[data-reveal="${CSS.escape(entry.id)}"]`)?.focus();
        },
      }, icon(shown ? 'eyeOff' : 'eye', 15))),
    h('td', { class: 'cell-url' }, entry.url
      ? h('a', { href: entry.url, target: '_blank', rel: 'noopener noreferrer', text: entry.url })
      : '—'),
    h('td', { class: 'cell-actions' },
      h('button', { class: 'btn btn-small', type: 'button', onClick: () => copySecret(entry.username ?? '', 'Username') }, icon('copy', 15), 'User'),
      h('button', { class: 'btn btn-small', type: 'button', onClick: () => copySecret(entry.password, 'Password') }, icon('copy', 15), 'Password'),
      h('button', { class: 'btn btn-small', type: 'button', onClick: () => editEntry(entry) }, icon('pencil', 15), 'Edit'),
      h('button', { class: 'btn btn-small btn-danger', type: 'button', onClick: () => removeEntry(entry) }, icon('trash', 15), 'Delete')));
}

function renderVaultRows() {
  const body = container?.querySelector('#vault-rows');
  const summary = container?.querySelector('#vault-summary');
  if (!body) return;
  clear(body);
  const matches = vaultMatches();
  for (const entry of matches) body.append(vaultRow(entry));
  if (!matches.length) {
    body.append(h('tr', {}, h('td', { colspan: '5' }, emptyState(query ? 'No entries match that search.' : 'The vault is empty. Add your first password.'))));
  }
  if (summary) summary.textContent = `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} • encrypted with Argon2id + AES-256-GCM`;
}

function unlockedView() {
  const search = h('input', {
    class: 'input input-inline', type: 'search', placeholder: 'Search vault', value: query, 'aria-label': 'Search vault entries',
    onInput: (event) => { query = event.target.value; renderVaultRows(); },
  });

  return h('div', {},
    h('div', { class: 'toolbar' },
      search,
      h('span', { class: 'chip chip-ok' }, icon('lockOpen', 14), 'Unlocked'),
      h('span', { class: 'chip chip-quiet', id: 'lock-countdown' }),
      h('div', { class: 'toolbar-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => editEntry() }, icon('plus'), 'Add password'),
        h('button', { class: 'btn', type: 'button', onClick: () => { lock(); toast('Vault locked.'); } }, icon('passwords'), 'Lock now'))),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'table' },
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col', text: 'Name' }),
          h('th', { scope: 'col', text: 'Username' }),
          h('th', { scope: 'col', text: 'Password' }),
          h('th', { scope: 'col', text: 'Website' }),
          h('th', { scope: 'col', text: 'Actions' }))),
        h('tbody', { id: 'vault-rows' }))),
    h('p', { class: 'table-summary', id: 'vault-summary' }),
    h('p', { class: 'hint', text: 'Passwords stay in this page while the vault is unlocked and are never written to disk in readable form. Firefox’s own password saving is switched off so the two stores do not compete.' }));
}

function render() {
  if (!container) return;
  clear(container);
  const view = state === 'unlocked' ? unlockedView()
    : state === 'locked' ? lockedView()
    : state === 'busy' ? busyView()
    : state === 'corrupt' ? corruptView()
    : createView();

  container.append(
    h('header', { class: 'section-head' },
      h('div', {}, h('h1', { text: 'Passwords' }),
        h('p', { class: 'section-sub', text: 'A local encrypted vault on this USB drive. No cloud, no telemetry.' })),
      state === 'unlocked' ? h('span', { class: 'chip chip-ok', text: `${entries.length} saved` }) : h('span', { class: 'chip chip-quiet', text: 'Locked by default' })),
    view);

  if (state === 'unlocked') {
    renderVaultRows();
    updateLockCountdown();
  }
  if (state === 'locked') container.querySelector('#master-unlock')?.focus();
}

export async function mount(target) {
  container = target;
  bindActivity();
  if (state === 'unknown') await loadVault();
  if (state === 'unlocked' && Date.now() - lastActivity > lockMinutes() * 60000) lock();
  render();
}