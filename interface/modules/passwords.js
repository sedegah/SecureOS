import { api, bus } from './api.js';
import { h, clear, toast, reportError, confirmDialog, formDialog, emptyState, formatDate, formatBytes } from './ui.js';
import { icon } from './icons.js';
import { getSettings } from './settings.js';
import { createVault, unlockVault, sealVault, masterPasswordStrength, MIN_MASTER_LENGTH, VaultError, MAX_VAULT_FILE_BYTES, encryptVaultFile, decryptVaultFile } from './vault-crypto.js';
import { isFingerprintSensorAvailable, isFingerprintEnrolled, removeFingerprintEnrollment, enrollFingerprint, unlockWithFingerprint } from './fingerprint.js';
import { isPreviewable, showPreview } from './preview.js';

let container = null;
let hasSensor = false;
let hasSensorChecked = false;
let state = 'unknown';
let envelope = null;
let key = null;
let entries = [];
let vaultFiles = [];
let fileBusy = false;
let selectedId = null;
let query = '';
let activeTab = 'passwords';
let errorMessage = '';
let revealed = new Set();
let lastActivity = Date.now();
let unlockTime = 0;
let clipboardTimer = null;
let lockTicker = null;
let activityBound = false;
let session = new AbortController();
let writes = Promise.resolve();

function serializeWrite(operation) {
  const result = writes.then(operation);
  writes = result.catch(() => {});
  return result;
}

bus.addEventListener('usb', (event) => {
  if (event.detail?.present === false) lock();
});
bus.addEventListener('helper-lost', () => lock());

function lockMinutes() {
  return Math.max(1, Number(getSettings().vaultLockMinutes) || 5);
}

function clipboardSeconds() {
  return Math.max(5, Number(getSettings().clipboardClearSeconds) || 20);
}

function bindActivity() {
  if (activityBound) return;
  activityBound = true;
  for (const event of ['pointerdown', 'keydown', 'wheel']) {
    document.addEventListener(event, (e) => {

      if (state === 'unlocked' && container?.isConnected && container.contains(e.target)) {
        lastActivity = Date.now();
      }
    }, { passive: true, capture: true });
  }
  lockTicker = setInterval(() => {
    if (state !== 'unlocked') return;
    if (Date.now() - lastActivity > lockMinutes() * 60000) {
      lock();
      toast('Vault locked after inactivity.');
    } else if (container?.isConnected) {
      updateLockCountdown();
    }
  }, 1000);
  bus.addEventListener('settings-changed', () => {
    if (state === 'unlocked') lastActivity = Date.now();
  });
}

export function lock() {
  session.abort();
  session = new AbortController();
  key = null;
  entries = [];
  vaultFiles = [];
  fileBusy = false;
  query = '';
  void window.surgeDesktop?.cancelVaultExport().catch(() => {});
  selectedId = null;
  revealed = new Set();
  unlockTime = 0;
  activeTab = 'passwords';
  void clearClipboard();
  if (state !== 'unknown' && state !== 'corrupt') {
    state = envelope ? 'locked' : 'no-vault';
    errorMessage = '';
  }
  if (container?.isConnected) render();
}

export function isUnlocked() {
  return state === 'unlocked';
}

async function persist(change, signal, changeFiles = (current) => current) {
  return serializeWrite(async () => {
    if (signal.aborted || state !== 'unlocked') return false;
    const nextEntries = change(entries);
    const nextFiles = changeFiles(vaultFiles);
    const next = await sealVault(key, envelope, { version: 1, entries: nextEntries, files: nextFiles });
    if (signal.aborted) return false;
    await api.writeVault(next);
    envelope = next;
    if (signal.aborted) return false;
    entries = nextEntries;
    vaultFiles = nextFiles;
    return true;
  });
}

async function importFiles(selected) {
  if (state !== 'unlocked' || fileBusy) return;
  const { signal } = session;
  fileBusy = true;
  render();
  try {
    for (const file of selected) {
      if (signal.aborted) return;
      if (file.size > MAX_VAULT_FILE_BYTES) throw new Error('Each vault file must be 16 MiB or smaller.');
      if (vaultFiles.length >= 1000) throw new Error('The vault supports up to 1,000 files.');
      const id = crypto.randomUUID();
      const bytes = new Uint8Array(await file.arrayBuffer());
      let sealed;
      try {
        if (signal.aborted) return;
        sealed = await encryptVaultFile(key, envelope, id, bytes);
      } finally { bytes.fill(0); }
      if (signal.aborted) return;
      await api.writeVaultFile(id, sealed);
      if (signal.aborted) return;
      const metadata = { id, name: file.name, size: file.size };
      const saved = await persist((current) => current, signal, (current) => [...current, metadata]);
      if (!saved || signal.aborted) return;
      toast('Encrypted file saved. The original file was not removed.');
    }
  } catch (error) {
    if (!signal.aborted) reportError(error);
  } finally {
    if (!signal.aborted) { fileBusy = false; render(); }
  }
}

async function exportFile(file) {
  if (state !== 'unlocked' || fileBusy || !window.surgeDesktop) return;
  const { signal } = session;
  const confirmed = await confirmDialog({
    signal, title: 'Export an unencrypted copy?', confirmLabel: 'Choose destination',
    message: `An ordinary, unencrypted copy of "${file.name}" will be written to your chosen folder. It will remain readable after the vault locks.`,
  });
  if (!confirmed || signal.aborted) return;
  fileBusy = true;
  render();
  let bytes;
  try {
    const ticket = await window.surgeDesktop.chooseVaultExport(file.name);
    if (!ticket || signal.aborted) return;
    const sealed = await api.readVaultFile(file.id);
    if (signal.aborted) return;
    bytes = await decryptVaultFile(key, envelope, file.id, sealed);
    if (signal.aborted) return;
    if (bytes.byteLength !== file.size) throw new Error('The encrypted file size does not match the vault record.');
    await window.surgeDesktop.writeVaultExport(ticket, bytes);
    if (!signal.aborted) toast('Unencrypted copy exported. The encrypted original remains in the vault.');
  } catch (error) {
    if (!signal.aborted) reportError(error);
  } finally {
    bytes?.fill(0);
    void window.surgeDesktop.cancelVaultExport().catch(() => {});
    if (!signal.aborted) { fileBusy = false; render(); }
  }
}

async function removeFile(file) {
  if (state !== 'unlocked' || fileBusy) return;
  const { signal } = session;
  const confirmed = await confirmDialog({
    signal, title: 'Delete encrypted file?', confirmLabel: 'Delete', danger: true,
    message: `Delete "${file.name}" from this vault? Keep an exported copy if you need it. Other backups and original files are not removed; this is not secure erasure.`,
  });
  if (!confirmed || signal.aborted) return;
  fileBusy = true;
  render();
  try {
    const saved = await persist((current) => current, signal, (current) => current.filter((item) => item.id !== file.id));
    if (!saved || signal.aborted) return;
    await api.removeVaultFile(file.id);
    if (!signal.aborted) toast('Encrypted file deleted from the vault.');
  } catch (error) {
    if (!signal.aborted) reportError(error);
  } finally {
    if (!signal.aborted) { fileBusy = false; render(); }
  }
}

async function previewVaultFile(file) {
  if (state !== 'unlocked' || fileBusy) return;
  const { signal } = session;
  fileBusy = true;
  render();
  let bytes = null;
  try {
    const sealed = await api.readVaultFile(file.id);
    if (signal.aborted) return;
    bytes = await decryptVaultFile(key, envelope, file.id, sealed);
    if (signal.aborted) return;
    const ext = (file.name.includes('.') ? file.name.split('.').pop() : '').toLowerCase();
    const mime = ext === 'pdf' ? 'application/pdf'
      : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext) ? `image/${ext === 'jpg' ? 'jpeg' : ext}`
      : ['txt', 'log'].includes(ext) ? 'text/plain; charset=utf-8'
      : ext === 'json' ? 'application/json; charset=utf-8'
      : ext === 'md' ? 'text/markdown; charset=utf-8'
      : 'application/octet-stream';
    const blob = new Blob([bytes], { type: mime });
    showPreview({
      title: file.name,
      blob,
      ext,
      size: file.size,
      onDownload: window.surgeDesktop ? () => { void exportFile(file); } : null,
    });
  } catch (error) {
    if (!signal.aborted) reportError(error);
  } finally {
    fileBusy = false;
    render();
  }
}

function encryptedFilesView() {
  const picker = h('input', {
    type: 'file', multiple: true, hidden: true, id: 'vault-file-input',
    onChange: () => {
      const selected = [...picker.files];
      picker.value = '';
      void importFiles(selected);
    }
  });

  const totalBytes = vaultFiles.reduce((acc, f) => acc + (f.size || 0), 0);

  const toolbar = h('div', { class: 'vault-files-toolbar' },
    h('div', { class: 'vault-files-summary' },
      h('span', { class: 'vault-files-count', text: `${vaultFiles.length} ${vaultFiles.length === 1 ? 'file' : 'files'}` }),
      totalBytes > 0 ? h('span', { class: 'vault-files-size mono', text: `· ${formatBytes(totalBytes)}` }) : null,
      h('span', { class: 'vault-files-hint', text: 'Encrypted with AES-256-GCM. Click any file to preview in Surge.' })),
    h('button', {
      class: 'btn btn-primary',
      type: 'button',
      disabled: fileBusy,
      onClick: () => picker.click(),
    }, icon('plus', 16), 'Import files'));

  if (!vaultFiles.length) {
    return h('div', { class: 'vault-files-pane' },
      picker,
      toolbar,
      h('div', { class: 'vault-empty-files' },
        icon('file', 36),
        h('p', { class: 'vault-empty-title', text: 'No private files in vault' }),
        h('p', { class: 'vault-empty-desc', text: 'Import sensitive documents, PDFs, photos, or keys. They will be encrypted with your master key and hidden from disk.' }),
        h('button', { class: 'btn btn-primary', type: 'button', disabled: fileBusy, onClick: () => picker.click() }, icon('plus', 16), 'Import your first file')));
  }

  const tableHead = h('thead', {},
    h('tr', {},
      h('th', { style: 'width: 40px;' }, ''),
      h('th', { text: 'Name' }),
      h('th', { style: 'width: 120px;', text: 'Size' }),
      h('th', { style: 'width: 220px; text-align: right;', text: 'Actions' })));

  const tableBody = h('tbody', {},
    vaultFiles.map((file) => {
      const ext = (file.name.includes('.') ? file.name.split('.').pop() : '').toLowerCase();
      const canPreview = isPreviewable(ext);
      const fileIcon = ext === 'pdf' ? 'file' : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext) ? 'eye' : 'file';

      const previewBtn = canPreview ? h('button', {
        class: 'btn btn-small',
        type: 'button',
        disabled: fileBusy,
        onClick: (e) => { e.stopPropagation(); void previewVaultFile(file); },
      }, icon('eye', 14), 'Preview') : null;

      const exportBtn = h('button', {
        class: 'btn btn-small',
        type: 'button',
        disabled: fileBusy || !window.surgeDesktop,
        onClick: (e) => { e.stopPropagation(); void exportFile(file); },
      }, icon('export', 14), 'Export');

      const deleteBtn = h('button', {
        class: 'btn btn-small btn-danger',
        type: 'button',
        disabled: fileBusy,
        onClick: (e) => { e.stopPropagation(); void removeFile(file); },
      }, icon('trash', 14), 'Delete');

      return h('tr', {
        class: 'vault-file-row',
        onClick: () => {
          if (canPreview) void previewVaultFile(file);
        },
      },
      h('td', { class: 'vault-file-icon-cell' }, icon(fileIcon, 18)),
      h('td', { class: 'vault-file-name-cell' },
        h('span', { class: 'vault-file-name', text: file.name }),
        canPreview ? h('span', { class: 'chip chip-quiet chip-inline', text: ext.toUpperCase() }) : null),
      h('td', { class: 'vault-file-size-cell mono', text: formatBytes(file.size) }),
      h('td', { class: 'vault-file-actions-cell' },
        h('div', { class: 'section-actions', style: 'justify-content: flex-end;' }, previewBtn, exportBtn, deleteBtn)));
    }));

  const table = h('table', { class: 'table vault-table' }, tableHead, tableBody);

  return h('div', { class: 'vault-files-pane' },
    picker,
    toolbar,
    fileBusy ? h('div', { class: 'vault-busy-banner' }, icon('refresh', 16), h('span', { text: 'Working on encrypted files…' })) : null,
    h('div', { class: 'table-wrap' }, table));
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

  }
}

async function copySecret(value, label) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    toast('Clipboard access was blocked. Use the show button and copy manually.', 'error');
    return;
  }
  const seconds = clipboardSeconds();
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

  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, icon('lock'), 'Create encrypted vault');
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

    const { signal } = session;
    const password = master.value;
    master.value = '';
    confirm.value = '';
    state = 'busy';
    render();
    try {
      const created = await createVault(password);
      const saved = await serializeWrite(async () => {
        if (signal.aborted) return false;
        await api.writeVault(created.envelope);
        envelope = created.envelope;
        if (signal.aborted) {
          if (state === 'no-vault') state = 'locked';
          return false;
        }
        key = created.key;
        entries = [];
        vaultFiles = [];
        state = 'unlocked';
        lastActivity = Date.now();
        return true;
      });
      if (saved) toast('Vault created and encrypted on the USB drive.');
    } catch (error) {
      if (signal.aborted) { reportError(error); return; }
      state = 'no-vault';
      errorMessage = error.message;
      reportError(error);
    }
    render();
  });

  return h('div', { class: 'card vault-card' },
    h('h2', { class: 'vault-title', text: 'Create your vault' }),
    h('p', { class: 'vault-note', text: 'The vault is encrypted on this USB drive with AES-256-GCM. The key is derived from your master password with Argon2id. Surge never stores the master password, and nothing is sent to any cloud service.' }),
    h('div', { class: 'banner banner-warn' }, icon('warning'),
      h('div', {},
        h('strong', { text: 'There is no recovery' }),
        h('p', { text: 'If you forget the master password, the vault cannot be opened again. There is no reset, no hint and no recovery key. Write it down and keep it somewhere safe, away from this USB drive.' }))),
    h('label', { class: 'field', for: 'master-new' }, h('span', { class: 'field-label', text: `Master password (minimum ${MIN_MASTER_LENGTH} characters)` }), master),
    meter,
    h('label', { class: 'field', for: 'master-confirm' }, h('span', { class: 'field-label', text: 'Repeat master password' }), confirm),
    h('label', { class: 'checkbox', for: 'master-understood' }, understood, h('span', { text: 'I understand that a forgotten master password cannot be recovered.' })),
    feedback,
    submit);
}

function lockedView() {
  const master = h('input', { class: 'input', type: 'password', id: 'master-unlock', autocomplete: 'current-password', spellcheck: 'false', placeholder: 'Master password', 'aria-label': 'Master password' });
  const feedback = h('p', { class: 'form-error', role: 'alert', text: errorMessage });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, icon('lockOpen'), 'Unlock with Password');

  const attempt = async (pwd) => {
    const { signal } = session;
    const password = pwd !== undefined ? pwd : master.value;
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
      await writes;
      if (signal.aborted) return;
      const opened = await unlockVault(envelope, password);
      if (signal.aborted) return;
      key = opened.key;
      entries = opened.vault.entries;
      vaultFiles = opened.vault.files;
      state = 'unlocked';
      lastActivity = Date.now();
      unlockTime = Date.now();
    } catch (error) {
      if (signal.aborted) return;
      state = 'locked';
      errorMessage = error instanceof VaultError ? error.message : 'The vault could not be unlocked.';
    }
    render();
    if (state === 'locked') container?.querySelector('#master-unlock')?.focus();
  };

  submit.addEventListener('click', () => attempt());
  master.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); void attempt(); }
  });

  const enrolled = hasSensor && isFingerprintEnrolled();
  let bioBtn = null;
  if (enrolled) {
    bioBtn = h('button', {
      class: 'btn btn-block',
      type: 'button',
      style: 'margin-bottom: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; border-color: var(--accent); color: var(--accent);',
      onClick: async () => {
        try {
          feedback.textContent = '';
          const pwd = await unlockWithFingerprint();
          await attempt(pwd);
        } catch (err) {
          state = 'locked';
          errorMessage = err.message || 'Fingerprint verification failed.';
          render();
        }
      }
    }, icon('fingerprint', 20), 'Unlock with Fingerprint Sensor');
  }

  return h('div', { class: 'card vault-card' },
    h('h2', { class: 'vault-title', text: 'Vault locked' }),
    h('p', { class: 'vault-note', text: enrolled
      ? 'Unlock with your fingerprint sensor, or enter your master password below.'
      : 'Enter your master password. It is never stored, and it cannot be recovered if you forget it.' }),
    bioBtn,
    enrolled ? h('div', { style: 'text-align: center; margin-bottom: 12px; color: var(--text-dim); font-size: 12px;' }, '— or enter master password —') : null,
    master,
    feedback,
    submit,
    h('p', { class: 'vault-foot', text: 'Locks automatically after inactivity' }),
    envelope?.updatedAt ? h('p', { class: 'vault-foot', text: `Vault last saved ${formatDate(envelope.updatedAt)}.` }) : null);
}

function busyView() {
  return h('div', { class: 'card vault-card' },
    h('h2', { class: 'vault-title', text: 'Working…' }),
    h('p', { class: 'vault-note', text: 'Deriving the encryption key with Argon2id. This deliberately takes a moment to slow down password guessing.' }));
}

function corruptView() {
  return h('div', { class: 'card vault-card' },
    h('h2', { class: 'vault-title', text: 'Vault file damaged' }),
    h('div', { class: 'banner banner-error', role: 'alert' }, icon('warning'),
      h('div', {}, h('strong', { text: 'Surge will not overwrite this vault' }), h('p', { text: errorMessage }))),
    h('p', { class: 'vault-note', text: 'Restore Data/PasswordVault/vault.enc (or its .bak copy) from your own backup, then reopen this page. Creating a new vault here would destroy the existing entries.' }));
}

async function editEntry(entry = null) {
  if (state !== 'unlocked') return;
  const { signal } = session;
  const values = await formDialog({
    signal,
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
  if (!values || signal.aborted || state !== 'unlocked') return;

  const now = new Date().toISOString();
  const id = entry?.id ?? crypto.randomUUID();
  try {
    const saved = await persist((current) => {
      if (!entry) return [...current, { id, ...values, createdAt: now, modifiedAt: now }];
      if (!current.some((item) => item.id === id)) throw new Error('This password entry is no longer available.');
      return current.map((item) => item.id === id ? { ...item, ...values, modifiedAt: now } : item);
    }, signal);
    if (!saved || signal.aborted) return;
    if (!entry) selectedId = id;
    toast(entry ? 'Password updated.' : 'Password added.');
    render();
  } catch (error) {
    reportError(error);
  }
}

async function removeEntry(entry) {
  if (state !== 'unlocked') return;
  const { signal } = session;
  const ok = await confirmDialog({
    signal,
    title: 'Delete password?',
    message: `"${entry.title}" will be removed from the encrypted vault. This cannot be undone.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok || signal.aborted || state !== 'unlocked') return;
  try {
    const saved = await persist((current) => current.filter((item) => item.id !== entry.id), signal);
    if (!saved || signal.aborted) return;
    revealed.delete(entry.id);
    if (selectedId === entry.id) selectedId = null;
    toast('Password deleted.');
    render();
  } catch (error) {
    reportError(error);
  }
}

function updateLockCountdown() {
  const node = container?.querySelector('#lock-countdown');
  if (!node) return;
  const elapsed = Date.now() - lastActivity;
  const total = lockMinutes() * 60000;
  const remaining = Math.max(0, total - elapsed);
  const seconds = Math.ceil(remaining / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  node.textContent = `Vault unlocked · auto-locks in ${mins}:${String(secs).padStart(2, '0')}`;
}

function vaultMatches() {
  const needle = query.trim().toLowerCase();
  return entries
    .filter((entry) => !needle || [entry.title, entry.username, entry.url].some((field) => (field ?? '').toLowerCase().includes(needle)))
    .sort((a, b) => a.title.localeCompare(b.title));
}

function renderVaultList() {
  const list = container?.querySelector('#vault-list');
  if (!list) return;
  clear(list);
  const matches = vaultMatches();
  if (!matches.length) {
    list.append(emptyState(query ? 'No entries match that search.' : 'The vault is empty. Add your first password.'));
    return;
  }
  for (const entry of matches) {
    list.append(h('button', {
      class: entry.id === selectedId ? 'note-item selected' : 'note-item',
      type: 'button',
      'aria-current': entry.id === selectedId ? 'true' : null,
      onClick: () => { selectedId = entry.id; renderVaultList(); renderDetail(); },
    },
    h('span', { class: 'note-item-title', text: entry.title }),
    h('span', { class: 'note-item-meta', text: entry.username || entry.url || 'No username' })));
  }
}

function secretField(label, value, actions = [], mono = false) {
  return h('div', { class: 'secret-field' },
    h('span', { class: 'field-label', text: label }),
    h('div', { class: 'secret-box' },
      h('span', { class: mono ? 'secret-value mono' : 'secret-value', text: value }),
      actions.length ? h('span', { class: 'secret-actions' }, actions) : null));
}

function renderDetail() {
  const pane = container?.querySelector('#vault-detail');
  if (!pane) return;
  clear(pane);

  const entry = entries.find((item) => item.id === selectedId) ?? null;
  if (!entry) {
    pane.append(emptyState('Select an entry on the left, or add a new password.'));
    return;
  }

  const shown = revealed.has(entry.id);
  const revealButton = h('button', {
    class: 'btn btn-small', type: 'button', 'aria-pressed': shown ? 'true' : 'false',
    onClick: () => {
      if (shown) revealed.delete(entry.id); else revealed.add(entry.id);
      renderDetail();
    },
  }, icon(shown ? 'eyeOff' : 'eye', 15), shown ? 'Hide' : 'Show');

  pane.append(
    h('h2', { class: 'vault-detail-title', text: entry.title }),
    secretField('Username', entry.username || '—', [
      h('button', { class: 'btn btn-small', type: 'button', onClick: () => copySecret(entry.username ?? '', 'Username') }, icon('copy', 15), 'Copy'),
    ]),
    secretField('Password', shown ? entry.password : '••••••••••••', [
      revealButton,
      h('button', { class: 'btn btn-small', type: 'button', onClick: () => copySecret(entry.password, 'Password') }, icon('copy', 15), 'Copy'),
    ], true),
    secretField('Website', entry.url || '—', entry.url
      ? [h('a', { class: 'btn btn-small', href: entry.url, target: '_blank', rel: 'noopener noreferrer' }, icon('open', 15), 'Open')]
      : []),
    entry.notes ? secretField('Notes', entry.notes) : null,
    h('p', { class: 'hint', text: `Clipboard clears ${clipboardSeconds()} seconds after copying.` }),
    h('div', { class: 'section-actions' },
      h('button', { class: 'btn', type: 'button', onClick: () => editEntry(entry) }, icon('pencil'), 'Edit'),
      h('button', { class: 'btn btn-danger', type: 'button', onClick: () => removeEntry(entry) }, icon('trash'), 'Delete')));
}

function unlockedView() {
  const search = h('input', {
    class: 'input', type: 'search', placeholder: 'Search vault', value: query, 'aria-label': 'Search vault entries',
    onInput: (event) => { query = event.target.value; renderVaultList(); renderDetail(); },
  });

  return h('div', { class: 'vault-layout' },
    h('aside', { class: 'note-sidebar' }, search, h('div', { class: 'note-list', id: 'vault-list' })),
    h('section', { class: 'card vault-detail', id: 'vault-detail' }));
}

function securityDashboardView() {
  const enrolled = hasSensor && isFingerprintEnrolled();

  let bioAction;
  if (!hasSensor) {
    bioAction = h('span', { class: 'chip chip-quiet', text: 'Hardware unavailable' });
  } else if (enrolled) {
    bioAction = h('div', { class: 'section-actions' },
      h('button', {
        class: 'btn btn-small',
        type: 'button',
        onClick: async () => {
          try {
            await unlockWithFingerprint();
            toast('Fingerprint sensor verified successfully!');
          } catch (err) {
            reportError(err);
          }
        }
      }, icon('check', 14), 'Test sensor'),
      h('button', {
        class: 'btn btn-small btn-danger',
        type: 'button',
        onClick: () => {
          removeFingerprintEnrollment();
          toast('Fingerprint sensor enrollment removed.');
          render();
        }
      }, 'Remove fingerprint'));
  } else {
    bioAction = h('button', {
      class: 'btn btn-small btn-primary',
      type: 'button',
      onClick: async () => {
        try {
          const res = await formDialog({
            title: 'Enroll Fingerprint Sensor',
            message: 'Enter your master password and touch your fingerprint sensor when prompted.',
            confirmLabel: 'Enroll Fingerprint',
            fields: [
              { name: 'pwd', label: 'Master password', type: 'password', required: true }
            ]
          });
          if (!res?.pwd) return;
          await enrollFingerprint(res.pwd);
          toast('Fingerprint sensor enrolled successfully!');
          render();
        } catch (err) {
          reportError(err);
        }
      }
    }, icon('fingerprint', 16), 'Enroll fingerprint');
  }

  const bioCard = h('div', { class: 'card vault-sec-card' },
    h('div', { class: 'card-head' },
      h('div', { class: 'vault-sec-card-title' },
        icon('fingerprint', 20),
        h('h2', { text: 'Fingerprint Sensor (Windows Hello)' }),
        hasSensor
          ? (enrolled ? h('span', { class: 'chip chip-ok', text: 'Enrolled' }) : h('span', { class: 'chip chip-quiet', text: 'Available' }))
          : h('span', { class: 'chip chip-quiet', text: 'Not detected' })),
      bioAction),
    h('p', { class: 'vault-sec-desc', text: enrolled
      ? 'Your fingerprint is enrolled. You can unlock your vault instantly with Windows Hello biometric verification.'
      : hasSensor
      ? 'A compatible fingerprint reader was detected on this PC. You can optionally enroll your fingerprint to unlock the vault without typing your master password.'
      : 'No compatible Windows Hello fingerprint or biometric reader is available on this system.' }));

  const lockCard = h('div', { class: 'card vault-sec-card' },
    h('div', { class: 'card-head' },
      h('div', { class: 'vault-sec-card-title' },
        icon('clock', 20),
        h('h2', { text: 'Inactivity Auto-Lock' }),
        h('span', { class: 'chip chip-ok', text: `${lockMinutes()} min timeout` })),
      h('button', {
        class: 'btn btn-small btn-danger',
        type: 'button',
        onClick: () => { lock(); toast('Vault locked.'); },
      }, icon('lock', 14), 'Lock now')),
    h('p', { class: 'vault-sec-desc', text: `Surge automatically encrypts and locks your passwords and private files after ${lockMinutes()} minutes of inactivity. Memory is cleared immediately upon lock.` }));

  const encCard = h('div', { class: 'card vault-sec-card' },
    h('div', { class: 'card-head' },
      h('div', { class: 'vault-sec-card-title' },
        icon('shield', 20),
        h('h2', { text: 'Encryption Architecture' }),
        h('span', { class: 'chip chip-quiet', text: 'Zero Knowledge' }))),
    h('div', { class: 'vault-sec-specs' },
      h('div', { class: 'info-row' }, h('span', { class: 'info-label', text: 'Key Derivation' }), h('span', { class: 'info-value mono', text: 'Argon2id (64 MiB RAM, 4 iter)' })),
      h('div', { class: 'info-row' }, h('span', { class: 'info-label', text: 'Vault Cipher' }), h('span', { class: 'info-value mono', text: 'AES-256-GCM authenticated' })),
      h('div', { class: 'info-row' }, h('span', { class: 'info-label', text: 'Vault Storage' }), h('span', { class: 'info-value mono', text: 'Data/PasswordVault/vault.enc' })),
      envelope?.updatedAt ? h('div', { class: 'info-row' }, h('span', { class: 'info-label', text: 'Last Saved' }), h('span', { class: 'info-value', text: formatDate(envelope.updatedAt) })) : null));

  return h('div', { class: 'vault-sec-grid' }, bioCard, lockCard, encCard);
}

function render() {
  if (!container) return;
  clear(container);
  const unlocked = state === 'unlocked';
  if (!unlocked) {
    const view = state === 'locked' ? lockedView()
      : state === 'busy' ? busyView()
      : state === 'corrupt' ? corruptView()
      : createView();
    container.append(
      h('header', { class: 'section-head' },
        h('div', {},
          h('h1', { text: 'Vault' }),
          h('p', { class: 'section-sub', text: 'A local encrypted vault on this USB drive. No cloud, no telemetry.' })),
        h('span', { class: 'chip chip-quiet', text: 'Locked by default' })),
      h('div', { class: 'vault-lock' }, view));
    if (state === 'locked') container.querySelector('#master-unlock')?.focus();
    return;
  }

  const primaryAction = activeTab === 'passwords'
    ? h('button', { class: 'btn btn-primary', type: 'button', onClick: () => editEntry() }, icon('plus'), 'Add entry')
    : activeTab === 'files'
    ? h('button', { class: 'btn btn-primary', type: 'button', disabled: fileBusy, onClick: () => container.querySelector('#vault-file-input')?.click() }, icon('plus'), 'Import files')
    : null;

  const header = h('header', { class: 'section-head' },
    h('div', {},
      h('h1', { text: 'Vault' }),
      h('p', { class: 'section-sub', id: 'lock-countdown' })),
    h('div', { class: 'section-actions' },
      primaryAction,
      h('button', { class: 'btn btn-danger', type: 'button', onClick: () => { lock(); toast('Vault locked.'); } }, icon('lock'), 'Lock now')));

  const tabNav = h('nav', { class: 'vault-tabs', ariaLabel: 'Vault sections' },
    h('button', {
      class: activeTab === 'passwords' ? 'vault-tab-btn active' : 'vault-tab-btn',
      type: 'button',
      onClick: () => { activeTab = 'passwords'; render(); },
    }, icon('lock', 15), 'Passwords', h('span', { class: 'vault-tab-badge', text: String(entries.length) })),
    h('button', {
      class: activeTab === 'files' ? 'vault-tab-btn active' : 'vault-tab-btn',
      type: 'button',
      onClick: () => { activeTab = 'files'; render(); },
    }, icon('file', 15), 'Private Files', h('span', { class: 'vault-tab-badge', text: String(vaultFiles.length) })),
    h('button', {
      class: activeTab === 'security' ? 'vault-tab-btn active' : 'vault-tab-btn',
      type: 'button',
      onClick: () => { activeTab = 'security'; render(); },
    }, icon('fingerprint', 15), 'Security & Biometrics', hasSensor && isFingerprintEnrolled() ? h('span', { class: 'vault-tab-badge ok', text: 'On' }) : null));

  let tabContent;
  if (activeTab === 'passwords') {
    tabContent = unlockedView();
  } else if (activeTab === 'files') {
    tabContent = encryptedFilesView();
  } else {
    tabContent = securityDashboardView();
  }

  container.append(
    header,
    h('div', { class: 'vault-workspace' },
      tabNav,
      h('div', { class: 'vault-tab-content' }, tabContent)));

  if (activeTab === 'passwords') {
    if (!selectedId || !entries.some((entry) => entry.id === selectedId)) selectedId = vaultMatches()[0]?.id ?? null;
    renderVaultList();
    renderDetail();
  }
  updateLockCountdown();
}

export async function mount(target) {
  container = target;
  bindActivity();
  if (!hasSensorChecked) {
    try {
      hasSensor = await isFingerprintSensorAvailable();
    } catch {
      hasSensor = false;
    }
    hasSensorChecked = true;
  }
  if (state === 'unknown') await loadVault();
  if (state === 'unlocked' && Date.now() - lastActivity > lockMinutes() * 60000) {
    lock();
  }
  render();
}

export function stop() {
  container = null;
}
