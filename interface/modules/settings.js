import { api, bus } from './api.js';
import { h, clear, toast, reportError, formatBytes, cardLabel, switchRow } from './ui.js';
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

  const persist = (patch) => updateSettings(patch).catch(reportError);

  const storage = status?.storage;
  target.append(
    h('header', { class: 'section-head' },
      h('div', {}, h('h1', { text: 'Settings' }), h('p', { class: 'section-sub', text: 'Workspace preferences' }))),
    h('div', { class: 'settings-grid' },
      h('div', { class: 'settings-col' },
        h('section', { class: 'card' },
          cardLabel('Workspace'),
          engine, lock, clipboard,
          h('div', { class: 'dialog-actions' }, save)),
        h('section', { class: 'card' },
          cardLabel('Storage'),
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
          infoRow('Downloads folder', 'SURGE/Downloads'))),
      h('div', { class: 'settings-col' },
        h('section', { class: 'card' },
          cardLabel('Browser'),
          infoRow('Browser', 'Surge Browser'),
          infoRow('Rendering engine', 'Chromium'),
          infoRow('Password storage', 'Surge encrypted vault only'),
          h('p', { class: 'hint', text: 'Websites open in a separate Surge Browser window. They cannot access workspace tools or your vault.' })),

        h('section', { class: 'card' },
          cardLabel('About'),
          h('p', { text: 'Surge Portable 1.0' }),
          h('p', { class: 'muted', text: '16GB edition · Windows 10 / 11 · No installation' })))),
    h('section', { class: 'card' },
      cardLabel('This USB drive'),
      infoRow('Surge version', status?.version ?? '1.0.0'),
      infoRow('Surge folder', status?.usbRoot ?? 'Unavailable'),
      infoRow('Browser profile', 'Data/BrowserProfile (on this USB)'),
      infoRow('Notes', 'Data/Notes/notes.json'),
      infoRow('Bookmarks', 'Data/Bookmarks/bookmarks.json'),
      infoRow('Password vault', 'Data/PasswordVault/vault.enc (encrypted)'),
      storage ? infoRow('Storage', `${formatBytes(storage.used)} used of ${formatBytes(storage.total)} • ${formatBytes(storage.free)} free`) : null),
    h('div', { class: 'banner banner-info' }, icon('warning'),
      h('div', {},
        h('strong', { text: 'Before you unplug' }),
        h('p', { text: 'Close Surge Browser and Surge, wait for saving to finish, then use "Safely Remove Hardware" in Windows. Pulling the USB out while Surge is writing can damage notes, bookmarks or the vault.' }))),
    h('p', { class: 'hint', text: 'Surge keeps your data on this USB drive, but Windows, antivirus software and websites may still leave their own traces on the computer you use. Surge is not a zero-trace or anonymity tool.' }));
}
