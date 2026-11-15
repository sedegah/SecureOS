import { api, bus } from './api.js';
import { h, clear, toast, reportError, formatBytes, cardLabel, switchRow, confirmDialog } from './ui.js';
import { icon } from './icons.js';

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

function selectField(id, label, options, value, hint = null) {
  return h('label', { class: 'field', for: id },
    h('span', { class: 'field-label', text: label }),
    h('select', { class: 'input', id }, options.map((option) => h('option', { value: String(option.value), selected: String(option.value) === String(value) }, option.label))),
    hint ? h('span', { class: 'field-hint', text: hint }) : null);
}

function infoRow(label, value) {
  return h('div', { class: 'info-row' }, h('span', { class: 'info-label', text: label }), h('span', { class: 'info-value', text: value }));
}

export async function mount(target) {
  const status = await api.status().catch(() => null);
  const settings = getSettings();
  clear(target);

  const engine = selectField('set-engine', 'Search engine',
    Object.entries(SEARCH_ENGINES).map(([value, entry]) => ({ value, label: entry.label })),
    settings.searchEngine, 'Used when the search box contains words instead of an address.');

  const lock = selectField('set-lock', 'Lock vault after inactivity',
    [1, 3, 5, 10, 15, 30, 60].map((value) => ({ value, label: `${value} minute${value === 1 ? '' : 's'}` })),
    settings.vaultLockMinutes);

  const clipboard = selectField('set-clipboard', 'Clear copied passwords after',
    [10, 20, 30, 60].map((value) => ({ value, label: `${value} seconds` })),
    settings.clipboardClearSeconds, 'Surge clears the clipboard only while this workspace tab stays open.');

  const persist = (patch) => updateSettings(patch).catch(reportError);

  const save = h('button', { class: 'btn btn-primary', type: 'button' }, icon('save'), 'Save preferences');
  save.addEventListener('click', async () => {
    try {
      await updateSettings({
        searchEngine: engine.querySelector('select').value,
        vaultLockMinutes: Number(lock.querySelector('select').value),
        clipboardClearSeconds: Number(clipboard.querySelector('select').value),
      });
      toast('Preferences saved to the USB drive.');
    } catch (error) {
      reportError(error);
    }
  });

  const storage = status?.storage;
  const usedPercent = storage && storage.total > 0 ? Math.min(100, Math.max(1, Math.round((storage.used / storage.total) * 100))) : 0;
  const storageClass = storage?.critical ? 'crit' : (storage?.low ? 'warn' : '');

  const storageMeter = storage ? h('div', { class: 'storage-meter' },
    h('div', { class: 'storage-meter-track' },
      h('div', { class: `storage-meter-fill ${storageClass}`.trim(), style: `width: ${usedPercent}%` })),
    h('div', { class: 'storage-meter-meta' },
      h('span', { text: `${formatBytes(storage.used)} used of ${formatBytes(storage.total)} (${usedPercent}%)` }),
      h('span', { text: `${formatBytes(storage.free)} available` }))) : null;

  const resetBtn = h('button', { class: 'btn btn-danger', type: 'button' }, icon('refresh'), 'Reset environment');
  resetBtn.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Reset Surge Environment',
      message: 'This will restore your workspace settings to defaults and remove saved notes, bookmarks, and preferences. Encrypted vault credentials will remain safe. Do you want to proceed?',
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

  target.append(
    h('header', { class: 'section-head' },
      h('div', {}, h('h1', { text: 'Settings' }), h('p', { class: 'section-sub', text: 'Workspace preferences and system health' }))),
    h('div', { class: 'settings-grid' },
      h('div', { class: 'settings-col' },
        h('section', { class: 'card' },
          cardLabel('Workspace & Security'),
          engine, lock, clipboard,
          switchRow({
            label: 'Warn below 1 GB free',
            checked: Boolean(settings.warnLowSpace),
            onChange: (value) => persist({ warnLowSpace: value }),
          }),
          switchRow({
            label: 'Strong warning below 500 MB',
            checked: Boolean(settings.warnCriticalSpace),
            onChange: (value) => persist({ warnCriticalSpace: value }),
          }),
          h('div', { class: 'dialog-actions', style: 'margin-top: 10px;' }, save)),
        h('section', { class: 'card' },
          cardLabel('System Maintenance'),
          h('p', { class: 'hint', text: 'Restore Surge to its initial factory clean state. Clears saved notes, bookmarks, preferences, and session cache while preserving encrypted vault entries.' }),
          h('div', { class: 'maintenance-panel' },
            h('div', { class: 'maintenance-actions' },
              h('span', { class: 'info-label', text: 'Requires confirmation before execution' }),
              resetBtn)),
          h('div', { class: 'banner banner-info', style: 'margin-top: 12px;' }, icon('warning'),
            h('div', {},
              h('strong', { text: 'Before you unplug' }),
              h('p', { text: 'Close Surge Browser and Surge before safely removing hardware in Windows to protect against data loss.' }))))),
      h('div', { class: 'settings-col' },
        h('section', { class: 'card' },
          cardLabel('Portable Storage & Health'),
          storageMeter,
          infoRow('Surge folder', status?.usbRoot ?? 'Unavailable'),
          infoRow('Downloads folder', 'SURGE/Downloads'),
          infoRow('Password vault', 'Data/PasswordVault/vault.enc (encrypted)'),
          infoRow('Notes & bookmarks', 'Data/Notes & Data/Bookmarks'),
          infoRow('Browser profile', 'Data/BrowserProfile (on this volume)')),
        h('section', { class: 'card' },
          cardLabel('Browser Runtime & Architecture'),
          infoRow('Application', `${status?.app ?? 'Surge'} ${status?.version ?? '1.0.0'}`),
          infoRow('Browser engine', 'Independent sandboxed Chromium'),
          infoRow('Password storage', 'Surge encrypted vault only'),
          infoRow('Host footprint', 'Zero host traces on computer'),
          h('p', { class: 'hint', style: 'margin-top: 10px;', text: 'Websites open in an isolated Chromium process boundary. They cannot access workspace tools, private files, or vault credentials.' })))));
}
