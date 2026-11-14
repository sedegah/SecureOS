import { api, bus } from './api.js';
import { h, clear, toast, reportError, formatBytes } from './ui.js';
import { icon } from './icons.js';

export const SEARCH_ENGINES = {
  duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  google: { label: 'Google', url: 'https://www.google.com/search?q=' },
  bing: { label: 'Bing', url: 'https://www.bing.com/search?q=' },
  startpage: { label: 'Startpage', url: 'https://www.startpage.com/sp/search?query=' },
};

const DEFAULTS = {
  theme: 'dark',
  searchEngine: 'duckduckgo',
  vaultLockMinutes: 5,
  clipboardClearSeconds: 20,
};

let current = { ...DEFAULTS };
const media = window.matchMedia('(prefers-color-scheme: light)');

export async function loadSettings() {
  const stored = await api.readDocument('settings');
  current = { ...DEFAULTS, ...(stored ?? {}) };
  if (!SEARCH_ENGINES[current.searchEngine]) current.searchEngine = DEFAULTS.searchEngine;
  applyTheme();
  return current;
}

export function getSettings() {
  return current;
}

export async function updateSettings(patch) {
  current = { ...current, ...patch };
  applyTheme();
  await api.writeDocument('settings', { version: 1, ...current });
  bus.dispatchEvent(new Event('settings-changed'));
}

export function applyTheme() {
  const theme = current.theme === 'system' ? (media.matches ? 'light' : 'dark') : current.theme;
  document.documentElement.dataset.theme = theme;
}

media.addEventListener('change', () => {
  if (current.theme === 'system') applyTheme();
});

export function searchUrl(query) {
  const engine = SEARCH_ENGINES[current.searchEngine] ?? SEARCH_ENGINES.duckduckgo;
  return engine.url + encodeURIComponent(query);
}

// Turns workspace input into either a website address or a web search.
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

  const theme = selectField('set-theme', 'Theme', [
    { value: 'dark', label: 'Dark blue' },
    { value: 'light', label: 'Light' },
    { value: 'system', label: 'Match Windows' },
  ], settings.theme);

  const engine = selectField('set-engine', 'Search engine',
    Object.entries(SEARCH_ENGINES).map(([value, engine]) => ({ value, label: engine.label })),
    settings.searchEngine, 'Used when the search box contains words instead of an address.');

  const lock = selectField('set-lock', 'Lock vault after inactivity',
    [1, 3, 5, 10, 15, 30, 60].map((value) => ({ value, label: `${value} minute${value === 1 ? '' : 's'}` })),
    settings.vaultLockMinutes);

  const clipboard = selectField('set-clipboard', 'Clear copied passwords after',
    [10, 20, 30, 60].map((value) => ({ value, label: `${value} seconds` })),
    settings.clipboardClearSeconds, 'Surge clears the clipboard only while this workspace tab stays open.');

  const save = h('button', { class: 'btn btn-primary', type: 'button' }, icon('check'), 'Save preferences');
  save.addEventListener('click', async () => {
    try {
      await updateSettings({
        theme: theme.querySelector('select').value,
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
  target.append(
    h('header', { class: 'section-head' },
      h('div', {}, h('h1', { text: 'Settings' }), h('p', { class: 'section-sub', text: 'Workspace preferences travel with the USB drive.' }))),
    h('div', { class: 'card' },
      h('h2', { class: 'card-title', text: 'Workspace' }),
      h('div', { class: 'form-grid' }, theme, engine, lock, clipboard),
      h('div', { class: 'dialog-actions' }, save)),
    h('div', { class: 'card' },
      h('h2', { class: 'card-title', text: 'This USB drive' }),
      infoRow('Surge version', status?.version ?? '1.0.0'),
      infoRow('Surge folder', status?.usbRoot ?? 'Unavailable'),
      infoRow('Browser profile', 'Data/Profile (on this USB)'),
      infoRow('Downloads', 'Downloads (on this USB)'),
      infoRow('Notes', 'Data/Notes/notes.json'),
      infoRow('Bookmarks', 'Data/Bookmarks/bookmarks.json'),
      infoRow('Password vault', 'Data/PasswordVault/vault.enc (encrypted)'),
      storage ? infoRow('Storage', `${formatBytes(storage.used)} used of ${formatBytes(storage.total)} • ${formatBytes(storage.free)} free`) : null),
    h('div', { class: 'banner banner-info' }, icon('warning'),
      h('div', {},
        h('strong', { text: 'Before you unplug' }),
        h('p', { text: 'Close Firefox, wait for Surge to finish saving, then use "Safely Remove Hardware" in Windows. Pulling the USB out while Surge is writing can damage notes, bookmarks or the vault.' }))),
    h('p', { class: 'hint', text: 'Surge keeps your data on this USB drive, but Windows, antivirus software and websites may still leave their own traces on the computer you use. Surge is not a zero-trace or anonymity tool.' }));
}