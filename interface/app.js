import { initSession, api, bus } from './modules/api.js';
import { h, clear, toast, reportError, formatBytes, relativeTime, emptyState, cardLabel } from './modules/ui.js';
import { icon } from './modules/icons.js';
import * as settings from './modules/settings.js';
import * as notes from './modules/notes.js';
import * as bookmarks from './modules/bookmarks.js';
import * as files from './modules/files.js';
import * as downloads from './modules/downloads.js';
import * as passwords from './modules/passwords.js';
import * as vpn from './modules/vpn.js';

const ROUTES = [
  { id: 'home', label: 'Home', icon: 'home', mount: renderHome },
  { id: 'files', label: 'Files', icon: 'files', mount: files.mount },
  { id: 'notes', label: 'Notes', icon: 'notes', mount: notes.mount },
  { id: 'bookmarks', label: 'Bookmarks', icon: 'bookmarks', mount: bookmarks.mount },
  { id: 'downloads', label: 'Downloads', icon: 'downloads', mount: downloads.mount },
  { id: 'passwords', label: 'Vault', icon: 'lock', mount: passwords.mount },
  { id: 'vpn', label: 'Browser proxy', icon: 'vpn', mount: vpn.mount },
  { id: 'settings', label: 'Settings', icon: 'settings', mount: settings.mount },
];

const TILES = [
  { route: 'browser', icon: 'globe', title: 'Surge Browser', sub: 'Open the web browser' },
  { route: 'files', icon: 'files', title: 'My Files', sub: 'USB documents' },
  { route: 'notes', icon: 'notes', title: 'My Notes', sub: 'Personal notes' },
  { route: 'bookmarks', icon: 'bookmarks', title: 'Bookmarks', sub: 'Saved websites' },
  { route: 'downloads', icon: 'downloads', title: 'Downloads', sub: 'Downloaded files' },
  { route: 'passwords', icon: 'lock', title: 'Vault', sub: 'Passwords and private files' },
  { route: 'vpn', icon: 'vpn', title: 'Browser proxy', sub: 'Bring your own server' },
];

const main = document.getElementById('main');
let currentRoute = 'home';

function buildNav() {
  const list = document.getElementById('nav-list');
  for (const route of ROUTES) {
    const button = h('button', {
      class: 'nav-item', type: 'button', dataset: { route: route.id },
      onClick: () => { location.hash = `#/${route.id}`; },
    }, icon(route.icon), h('span', { text: route.label }));
    list.append(h('li', {}, button));
  }

  list.addEventListener('keydown', (event) => {
    const buttons = [...list.querySelectorAll('.nav-item')];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    let next = null;
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    if (next !== null) {
      event.preventDefault();
      buttons[next].focus();
    }
  });
}

function markActiveRoute() {
  for (const button of document.querySelectorAll('.nav-item')) {
    const active = button.dataset.route === currentRoute;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  document.getElementById('titlebar-section').textContent =
    ROUTES.find((entry) => entry.id === currentRoute)?.label ?? '';
}

function navigate(route) {
  if (route === 'browser') {
    if (window.surgeDesktop) void window.surgeDesktop.openBrowser().catch(reportError);
    else toast('Launch the standalone Surge desktop to open Surge Browser.', 'warn');
    return;
  }
  location.hash = `#/${route}`;
}

let routing = Promise.resolve();

function route() {
  routing = routing.then(applyRoute).catch(reportError);
  return routing;
}

async function applyRoute() {
  const requested = location.hash.replace(/^#\/?/, '').split('?')[0];
  const match = ROUTES.find((entry) => entry.id === requested) ?? ROUTES[0];
  try {
    await notes.flushPendingSave();
  } catch (error) {
    history.replaceState(null, '', `#/${currentRoute}`);
    reportError(error);
    return;
  }
  if (match.id !== 'notes') await notes.stop();
  if (match.id !== 'passwords') passwords.stop();
  if (match.id !== 'bookmarks') bookmarks.stop();
  currentRoute = match.id;
  markActiveRoute();
  if (match.id !== 'vpn') vpn.stop();
  clear(main);
  main.setAttribute('aria-busy', 'true');
  try {
    await match.mount(main);
  } catch (error) {
    reportError(error);
    main.append(emptyState('That section could not be loaded. Check that the USB drive is still connected.'));
  }
  main.removeAttribute('aria-busy');
}

function updateStorage(status) {
  const storage = status?.storage;
  const block = document.getElementById('storage');
  const chip = document.getElementById('usb-chip');
  document.getElementById('status-path').textContent = status?.usbRoot ?? '';

  if (!status?.usbPresent) {
    chip.className = 'chip chip-error';
    chip.textContent = 'USB disconnected';
    block.hidden = true;
    showSpaceBanner(null);
    return;
  }

  chip.className = 'chip chip-ok';
  chip.textContent = 'USB ready';

  if (!storage) {
    block.hidden = true;
    showSpaceBanner(null);
    return;
  }

  block.hidden = false;
  const percent = storage.total > 0 ? Math.min(100, Math.round((storage.used / storage.total) * 100)) : 0;
  document.getElementById('storage-value').textContent = `${formatBytes(storage.free)} free of ${formatBytes(storage.total)}`;
  const fill = document.getElementById('storage-fill');
  fill.style.width = `${percent}%`;
  fill.className = storage.critical ? 'storage-fill critical' : storage.low ? 'storage-fill low' : 'storage-fill';
  block.title = `${formatBytes(storage.used)} used (${percent}%)`;
  showSpaceBanner(storage);
}

function showSpaceBanner(storage) {
  const banner = document.getElementById('space-banner');
  const prefs = settings.getSettings();
  const critical = storage?.critical && prefs.warnCriticalSpace;
  const low = !critical && storage?.low && prefs.warnLowSpace;

  if (!critical && !low) {
    banner.hidden = true;
    clear(banner);
    return;
  }

  clear(banner).append(icon('warning'),
    h('div', {},
      h('strong', { text: critical ? 'USB drive almost full' : 'USB drive running low' }),
      h('p', {
        text: critical
          ? `Only ${formatBytes(storage.free)} left. Saving may fail. Move files off the drive, or delete ones you no longer need.`
          : `${formatBytes(storage.free)} left. Downloads and notes need room to save.`,
      })));
  banner.hidden = false;
}

function showUsbBanner(present) {
  const banner = document.getElementById('usb-banner');
  if (present) {
    banner.hidden = true;
    clear(banner);
    return;
  }
  clear(banner).append(icon('warning'),
    h('div', {},
      h('strong', { text: 'Surge USB drive disconnected' }),
      h('p', { text: 'Saving and file operations are paused. Reconnect the drive to continue. Surge has not created any folders on this computer.' })));
  banner.hidden = false;
}

async function refreshStatus() {
  try {
    const [heartbeat, status] = await Promise.all([api.heartbeat(), api.status()]);
    updateStorage(status);
    showUsbBanner(heartbeat.usbPresent && status.usbPresent);
  } catch (error) {
    if (error.code === 'usb-missing') {
      updateStorage({ usbPresent: false });
      showUsbBanner(false);
    }
  }
}

function searchPanel() {
  const input = h('input', {
    class: 'input search-input', type: 'text', id: 'surge-search',
    placeholder: 'Search the web or enter an address', 'aria-label': 'Search the web or enter an address',
    autocomplete: 'off', spellcheck: 'false',
  });
  const form = h('form', { class: 'search' },
    icon('search', 20),
    input,
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Go'));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const target = settings.resolveNavigation(input.value);
    if (!target) {
      toast('Type a website address or some search words.', 'error');
      return;
    }
    if (window.surgeDesktop) void window.surgeDesktop.openBrowser(target).catch(reportError);
    else window.open(target, '_blank', 'noopener');
    input.value = '';
  });
  return form;
}

function recentNotesCard() {
  const recent = notes.recentNotes(4);
  const card = h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      cardLabel('Recent notes'),
      h('button', { class: 'btn btn-small', type: 'button', onClick: () => navigate('notes') }, 'All notes')));

  if (!recent.length) {
    card.append(emptyState('No notes yet. Open My Notes to write your first one.'));
    return card;
  }

  card.append(h('ul', { class: 'mini-list' }, recent.map((note) => h('li', {},
    h('button', { class: 'mini-item', type: 'button', onClick: () => notes.openNote(note.id) },
      h('span', { class: 'mini-title', text: note.title }),
      h('span', { class: 'mini-meta', text: relativeTime(note.modifiedAt) }))))));
  return card;
}

async function latestDownloadsCard() {
  const latest = await downloads.latestDownloads(4);
  const card = h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      cardLabel('Latest downloads'),
      h('button', { class: 'btn btn-small', type: 'button', onClick: () => navigate('downloads') }, 'All downloads')));

  if (!latest.length) {
    card.append(emptyState('Nothing downloaded yet. Surge Browser saves files to Downloads.'));
    return card;
  }

  card.append(h('ul', { class: 'mini-list' }, latest.map((entry) => h('li', {},
    h('button', {
      class: 'mini-item', type: 'button',
      onClick: () => api.open(`Downloads/${entry.name}`).catch(reportError),
    },
    h('span', { class: 'mini-title', text: entry.name }),
    h('span', { class: 'mini-meta', text: formatBytes(entry.size) }))))));
  return card;
}

function refreshPill() {
  const slot = document.getElementById('vpn-pill-slot');
  if (slot) clear(slot).append(vpn.pill(() => navigate('vpn')));
}

async function renderHome(target) {
  clear(target);
  target.append(
    h('section', { class: 'hero' },
      h('div', { class: 'hero-top' },
        h('div', {},
          h('h1', { class: 'hero-title', text: 'Surge workspace' }),
          h('p', { class: 'hero-sub', text: 'Everything you need, wherever you go.' })),
        h('div', { class: 'section-actions' },
          h('button', { id: 'open-surge-browser', class: 'btn btn-primary', type: 'button', onClick: () => navigate('browser') }, icon('globe'), 'Open Surge Browser'),
          h('span', { id: 'vpn-pill-slot' }, vpn.pill(() => navigate('vpn'))))),
      searchPanel()),
    h('div', { class: 'tiles' }, TILES.map((tile) => h('button', {
      class: 'tile', type: 'button', onClick: () => navigate(tile.route),
    }, icon(tile.icon, 22), h('span', { class: 'tile-title', text: tile.title }), h('span', { class: 'tile-sub', text: tile.sub })))),
    h('div', { class: 'grid-2' }, recentNotesCard(), await latestDownloadsCard()));

  target.querySelector('#surge-search')?.focus();
}

function renderFatal(message) {
  clear(main).append(h('div', { class: 'card' },
    h('h1', { text: 'Surge is not running' }),
    h('p', { text: message })));
}

async function boot() {
  buildNav();
  const token = initSession();
  if (!token) {
    renderFatal('This page must be opened by Surge.exe from the USB drive. Double-click Surge.exe in the SURGE folder to start your workspace.');
    return;
  }

  try {
    await Promise.all([settings.loadSettings(), notes.loadNotes(), bookmarks.loadBookmarks()]);
  } catch (error) {
    reportError(error);
  }

  bus.addEventListener('usb', (event) => {
    updateStorage({ usbPresent: event.detail.present });
    showUsbBanner(event.detail.present);
  });
  bus.addEventListener('helper-lost', () => {
    showUsbBanner(false);
    toast('The Surge helper stopped. Close Surge and start Surge.exe again.', 'error');
  });
  bus.addEventListener('restored-from-backup', () => toast('A damaged workspace file was recovered from its backup copy.', 'warn'));
  bus.addEventListener('notes-changed', () => { if (currentRoute === 'home') void renderHome(main); });
  bus.addEventListener('bookmarks-changed', () => { if (currentRoute === 'home') void renderHome(main); });
  bus.addEventListener('vpn-changed', refreshPill);
  bus.addEventListener('settings-changed', () => { void refreshStatus(); });

  window.surgeDesktop?.onBookmark((bookmark) => {
    void bookmarks.addItem(bookmark).then(() => toast('Bookmark saved.')).catch(reportError);
  });
  window.surgeDesktop?.onNavigate((destination) => {
    if (ROUTES.some((entry) => entry.id === destination)) navigate(destination);
  });
  window.addEventListener('hashchange', () => { void route(); });
  window.addEventListener('beforeunload', () => { passwords.lock(); void notes.flushPendingSave().catch(() => {}); });

  await refreshStatus();
  setInterval(() => { void refreshStatus(); }, 20000);
  await route();
  await vpn.start();
  refreshPill();
}

void boot();