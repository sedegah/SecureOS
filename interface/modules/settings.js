import { api, bus } from './api.js';
import { h, clear, toast, reportError, formatBytes, cardLabel, switchRow, confirmDialog, formDialog, promptDialog } from './ui.js';
import { icon } from './icons.js';
import {
  getProfile, addPassword, changePassword, removePassword, renameProfile, lockWorkspace,
} from './lock.js';
import { MIN_LOCK_PASSWORD_LENGTH } from './lock-crypto.js';
import * as passwords from './passwords.js';

export const SEARCH_ENGINES = {
  duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  google: { label: 'Google', url: 'https://www.google.com/search?q=' },
  bing: { label: 'Bing', url: 'https://www.bing.com/search?q=' },
  startpage: { label: 'Startpage', url: 'https://www.startpage.com/sp/search?query=' },
};

const DEFAULTS = {
  searchEngine: 'duckduckgo',
  vaultLockMinutes: 5,
  clipboardClearSeconds: 20,
  warnLowSpace: true,
  warnCriticalSpace: true,
};

let current = { ...DEFAULTS };

export async function loadSettings() {
  const stored = await api.readDocument('settings');
  current = { ...DEFAULTS, ...(stored ?? {}) };
  if (!SEARCH_ENGINES[current.searchEngine]) current.searchEngine = DEFAULTS.searchEngine;
  return current;
}

export function getSettings() {
  return current;
}

export async function updateSettings(patch) {
  const next = { ...current, ...patch };
  await api.writeDocument('settings', { version: 1, ...next });
  current = next;
  bus.dispatchEvent(new Event('settings-changed'));
}

export function searchUrl(query) {
  const engine = SEARCH_ENGINES[current.searchEngine] ?? SEARCH_ENGINES.duckduckgo;
  return engine.url + encodeURIComponent(query);
}

export function resolveNavigation(input) {
  const value = input.trim();
  if (!value) return null;

  const looksLikeUrl = !/\s/.test(value) && (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^[^\s.]+\.[^\s]{2,}$/.test(value) || value.toLowerCase().startsWith('localhost'));
  if (!looksLikeUrl) return searchUrl(value);

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return searchUrl(value);
    return url.href;
  } catch {
    return searchUrl(value);
  }
}

// ------------------------------------------------------------------ helpers

function selectField(id, label, options, value, hint = null) {
  return h('label', { class: 'field', for: id },
    h('span', { class: 'field-label', text: label }),
    h('select', { class: 'input', id }, options.map((option) => h('option', { value: String(option.value), selected: String(option.value) === String(value) }, option.label))),
    hint ? h('span', { class: 'field-hint', text: hint }) : null);
}

function infoRow(label, value) {
  return h('div', { class: 'info-row' },
    h('span', { class: 'info-label', text: label }),
    h('span', { class: 'info-value', text: value }));
}

function initialsFor(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A card body: rows and controls stack with one consistent rhythm. */
function cardBody(...children) {
  return h('div', { class: 'settings-body' }, children);
}

/** The action strip that closes a card, aligned to the card's own padding. */
function cardActions(...buttons) {
  return h('div', { class: 'settings-actions' }, buttons);
}

// ------------------------------------------------------------------- cards

/**
 * Profile and lock screen. Without a password the workspace opens straight
 * away; the destructive action is kept apart from the everyday ones.
 */
function profileCard(reload) {
  const profile = getProfile();
  const run = (action, success) => async () => {
    try {
      await action();
      toast(success);
      await reload();
    } catch (error) {
      toast(error?.message ?? 'That change could not be saved.', 'error');
    }
  };

  const everyday = [];

  if (profile.secured) {
    everyday.push(h('button', {
      class: 'btn', type: 'button',
      onClick: async () => {
        const values = await formDialog({
          title: 'Change lock screen password',
          confirmLabel: 'Change password',
          fields: [
            { name: 'current', label: 'Current password', type: 'password', required: true },
            { name: 'next', label: 'New password', type: 'password', required: true, hint: `At least ${MIN_LOCK_PASSWORD_LENGTH} characters.` },
            { name: 'confirm', label: 'Confirm new password', type: 'password', required: true },
          ],
        });
        if (!values) return;
        if (values.next !== values.confirm) { toast('The two new passwords do not match.', 'error'); return; }
        await run(() => changePassword(values.current, values.next), 'Lock screen password changed.')();
      },
    }, icon('lock'), 'Change password'));

    everyday.push(h('button', {
      class: 'btn', type: 'button',
      onClick: async () => {
        passwords.lock();
        await lockWorkspace();
      },
    }, icon('lock'), 'Lock now'));
  } else {
    everyday.push(h('button', {
      class: 'btn btn-primary', type: 'button',
      onClick: async () => {
        const values = await formDialog({
          title: 'Add a lock screen password',
          confirmLabel: 'Save password',
          message: 'Surge will ask for this password whenever the workspace opens.',
          fields: [
            { name: 'next', label: 'Password', type: 'password', required: true, hint: `At least ${MIN_LOCK_PASSWORD_LENGTH} characters.` },
            { name: 'confirm', label: 'Confirm password', type: 'password', required: true },
          ],
        });
        if (!values) return;
        if (values.next !== values.confirm) { toast('The two passwords do not match.', 'error'); return; }
        await run(() => addPassword(values.next), 'Lock screen password saved.')();
      },
    }, icon('lock'), 'Add a password'));
  }

  everyday.push(h('button', {
    class: 'btn', type: 'button',
    onClick: async () => {
      const name = await promptDialog({
        title: 'Profile name',
        label: 'The name shown on the lock screen',
        value: profile.name,
        confirmLabel: 'Save name',
      });
      if (name === null) return;
      await run(() => renameProfile(name), 'Profile name updated.')();
    },
  }, 'Change name'));

  const danger = profile.secured
    ? h('div', { class: 'settings-danger' },
      h('div', { class: 'settings-danger-text' },
        h('span', { class: 'settings-danger-title', text: 'Remove the password' }),
        h('span', { class: 'settings-danger-hint', text: 'Surge will open straight into the workspace on this drive.' })),
      h('button', {
        class: 'btn btn-danger', type: 'button',
        onClick: async () => {
          const values = await formDialog({
            title: 'Remove lock screen password',
            confirmLabel: 'Remove password',
            message: 'Surge will open straight into the workspace. Your files and the password vault stay exactly as they are.',
            fields: [{ name: 'current', label: 'Current password', type: 'password', required: true }],
          });
          if (!values) return;
          await run(() => removePassword(values.current), 'Lock screen password removed.')();
        },
      }, 'Remove password'))
    : null;

  return h('section', { class: 'card settings-card' },
    cardLabel('Profile & lock screen'),
    cardBody(
      h('div', { class: 'profile-head' },
        h('div', { class: 'profile-avatar', 'aria-hidden': 'true', text: initialsFor(profile.name) }),
        h('div', { class: 'profile-meta' },
          h('span', { class: 'profile-name', text: profile.name || 'No profile yet' }),
          h('span', { class: `chip ${profile.secured ? 'chip-ok' : 'chip-quiet'}`, text: profile.secured ? 'Password required at startup' : 'Opens without a password' }))),
      h('p', { class: 'settings-note', text: profile.secured
        ? 'This password is stored as an Argon2id hash on the drive. It cannot be recovered, so keep a copy somewhere safe.'
        : 'Add a password if this drive could be picked up by someone else. Until then Surge opens straight into the workspace.' }),
      cardActions(...everyday),
      danger,
      h('p', { class: 'settings-note settings-note-quiet', text: 'The lock screen hides the workspace from someone who opens Surge. It does not encrypt notes or files — the password vault protects its own contents.' })));
}

function workspaceCard(settings, reload) {
  const persist = (patch) => updateSettings(patch).catch(reportError);

  const engine = selectField('set-engine', 'Search engine',
    Object.entries(SEARCH_ENGINES).map(([value, entry]) => ({ value, label: entry.label })),
    settings.searchEngine, 'Words search; addresses navigate.');

  const lock = selectField('set-lock', 'Lock vault after',
    [1, 3, 5, 10, 15, 30, 60].map((value) => ({ value, label: `${value} minute${value === 1 ? '' : 's'}` })),
    settings.vaultLockMinutes, 'Idle time before it locks.');

  const clipboard = selectField('set-clipboard', 'Clear copied passwords',
    [10, 20, 30, 60].map((value) => ({ value, label: `${value} seconds` })),
    settings.clipboardClearSeconds, 'While this tab stays open.');

  const save = h('button', {
    class: 'btn btn-primary', type: 'button',
    onClick: async () => {
      try {
        await updateSettings({
          searchEngine: engine.querySelector('select').value,
          vaultLockMinutes: Number(lock.querySelector('select').value),
          clipboardClearSeconds: Number(clipboard.querySelector('select').value),
        });
        toast('Preferences saved to the drive.');
        await reload();
      } catch (error) {
        reportError(error);
      }
    },
  }, icon('save'), 'Save preferences');

  return h('section', { class: 'card settings-card' },
    cardLabel('Workspace & Security'),
    cardBody(
      h('div', { class: 'settings-fields' }, engine, lock, clipboard),
      h('div', { class: 'settings-switches' },
        switchRow({
          label: 'Warn below 1 GB free',
          checked: Boolean(settings.warnLowSpace),
          onChange: (value) => persist({ warnLowSpace: value }),
        }),
        switchRow({
          label: 'Strong warning below 500 MB',
          checked: Boolean(settings.warnCriticalSpace),
          onChange: (value) => persist({ warnCriticalSpace: value }),
        })),
      cardActions(save)));
}

function storageCard(status) {
  const storage = status?.storage;
  const usedPercent = storage && storage.total > 0
    ? Math.min(100, Math.max(1, Math.round((storage.used / storage.total) * 100)))
    : 0;
  const storageClass = storage?.critical ? 'crit' : (storage?.low ? 'warn' : '');

  const meter = storage ? h('div', { class: 'storage-meter' },
    h('div', {
      class: 'storage-meter-track',
      role: 'meter',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': String(usedPercent),
      'aria-label': 'Drive space used',
    },
    h('div', { class: `storage-meter-fill ${storageClass}`.trim(), style: `width: ${usedPercent}%` })),
    h('div', { class: 'storage-meter-meta' },
      h('span', { text: `${formatBytes(storage.used)} of ${formatBytes(storage.total)} used` }),
      h('span', { text: `${formatBytes(storage.free)} free` }))) : null;

  return h('section', { class: 'card settings-card' },
    cardLabel('Portable Storage & Health'),
    cardBody(
      meter,
      h('div', { class: 'settings-rows' },
        infoRow('Surge folder', status?.usbRoot ?? 'Unavailable'),
        infoRow('Downloads', 'SURGE/Downloads'),
        infoRow('Password vault', 'Data/PasswordVault/vault.enc (encrypted)'),
        infoRow('Notes & bookmarks', 'Data/Notes · Data/Bookmarks'),
        infoRow('Browser profile', 'Data/BrowserProfile (on this volume)'))));
}

function runtimeCard(status) {
  const application = status?.version ? `${status?.app ?? 'Surge'} v${status.version}` : (status?.app ?? 'Surge');
  return h('section', { class: 'card settings-card' },
    cardLabel('Browser Runtime & Architecture'),
    cardBody(
      h('div', { class: 'settings-rows' },
        infoRow('Application', application),
        infoRow('Browser engine', 'Independent sandboxed Chromium'),
        infoRow('Password storage', 'Surge encrypted vault only'),
        infoRow('Host footprint', 'Zero host traces on computer')),
      h('p', { class: 'settings-note settings-note-quiet', text: 'Websites open in an isolated Chromium process boundary. They cannot reach workspace tools, private files, or vault credentials.' })));
}

function maintenanceCard() {
  const resetBtn = h('button', { class: 'btn btn-danger', type: 'button' }, icon('refresh'), 'Reset environment');
  resetBtn.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Reset Surge Environment',
      message: 'This will restore your workspace settings to defaults and remove saved notes, bookmarks, preferences, and the lock screen profile. Encrypted vault credentials will remain safe. Do you want to proceed?',
      confirmLabel: 'Reset environment',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.systemReset({ resetVault: false });
      toast('Workspace environment reset successfully.');
      setTimeout(() => location.reload(), 1200);
    } catch (err) {
      reportError(err);
    }
  });

  return h('section', { class: 'card settings-card' },
    cardLabel('System Maintenance'),
    cardBody(
      h('div', { class: 'settings-danger settings-danger-quiet' },
        h('div', { class: 'settings-danger-text' },
          h('span', { class: 'settings-danger-title', text: 'Reset environment' }),
          h('span', { class: 'settings-danger-hint', text: 'Clears notes, bookmarks, preferences and the lock profile. The encrypted vault is kept.' })),
        resetBtn),
      h('div', { class: 'banner banner-info' }, icon('warning'),
        h('div', {},
          h('strong', { text: 'Before you unplug' }),
          h('p', { text: 'Close Surge Browser and Surge, then eject safely in Windows to protect against data loss.' })))));
}

// -------------------------------------------------------------------- page

export async function mount(target) {
  const status = await api.status().catch(() => null);
  const settings = getSettings();
  clear(target);

  const reload = () => mount(target);

  target.append(
    h('header', { class: 'section-head' },
      h('div', {},
        h('h1', { text: 'Settings' }),
        h('p', { class: 'section-sub', text: 'Workspace preferences, profile and drive health' }))),
    h('div', { class: 'settings-page' },
      h('div', { class: 'settings-grid' },
        h('div', { class: 'settings-col' },
          profileCard(() => reload()),
          workspaceCard(settings, () => reload())),
        h('div', { class: 'settings-col' },
          storageCard(status),
          runtimeCard(status),
          maintenanceCard()))));
}
