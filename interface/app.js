import { initSession, api, bus } from './modules/api.js';
import { h, clear, toast, reportError, formatBytes, relativeTime, emptyState } from './modules/ui.js';
import { icon } from './modules/icons.js';
import * as settings from './modules/settings.js';
import * as notes from './modules/notes.js';
import * as bookmarks from './modules/bookmarks.js';
import * as files from './modules/files.js';
import * as downloads from './modules/downloads.js';
import * as passwords from './modules/passwords.js';

const ROUTES = [
  { id: 'home', label: 'Home', icon: 'home', mount: renderHome },
  { id: 'files', label: 'Files', icon: 'files', mount: files.mount },
  { id: 'notes', label: 'Notes', icon: 'notes', mount: notes.mount },
  { id: 'bookmarks', label: 'Bookmarks', icon: 'bookmarks', mount: bookmarks.mount },
  { id: 'downloads', label: 'Downloads', icon: 'downloads', mount: downloads.mount },
  { id: 'passwords', label: 'Passwords', icon: 'passwords', mount: passwords.mount },
  { id: 'settings', label: 'Settings', icon: 'settings', mount: settings.mount },
];

const TILES = [
  { route: 'files', icon: 'files', title: 'My Files', sub: 'USB documents' },
  { route: 'notes', icon: 'notes', title: 'My Notes', sub: 'Personal notes' },
  { route: 'bookmarks', icon: 'bookmarks', title: 'Bookmarks', sub: 'Saved websites' },
  { route: 'downloads', icon: 'downloads', title: 'Downloads', sub: 'Downloaded files' },
  { route: 'passwords', icon: 'passwords', title: 'Passwords', sub: 'Encrypted vault' },
  { route: 'settings', icon: 'settings', title: 'Settings', sub: 'Workspace preferences' },
];

const main = document.getElementById('main');
let currentRoute = 'home';
let lastStatus = null;

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
}

function navigate(route) {
  location.hash = `#/${route}`;
}

async function route() {
  const requested = location.hash.replace(/^#\/?/, '').split('?')[0];
  const match = ROUTES.find((entry) => entry.id === requested) ?? ROUTES[0];
  currentRoute = match.id;
  markActiveRoute();
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

  if (!status?.usbPresent) {
    chip.className = 'chip chip-error';
    chip.textContent = 'USB disconnected';
    block.hidden = true;
    return;
  }

  chip.className = 'chip chip-ok';
  chip.textContent = 'USB ready';

  if (!storage) {
    block.hidden = true;
    return;
  }

  block.hidden = false;
  const percent = storage.total > 0 ? Math.min(100, Math.round((storage.used / storage.total) * 100)) : 0;
  document.getElementById('storage-value').textContent = `${formatBytes(storage.free)} free of ${formatBytes(storage.total)}`;
  const fill = document.getElementById('storage-fill');
  fill.style.width = `${percent}%`;
  fill.className = storage.critical ? 'storage-fill critical' : storage.low ? 'storage-fill low' : 'storage-fill';
  block.title = `${formatBytes(storage.used)} used (${percent}%)`;
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
    lastStatus = status;
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
    window.open(target, '_blank', 'noopener');
    input.value = '';
  });
  return form;
}

function shortcutStrip() {
  const pinned = bookmarks.pinnedItems(8);
  const card = h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title', text: 'Shortcuts' }),
      h('button', { class: 'btn btn-small', type: 'button', onClick: () => navigate('bookmarks') }, icon('pencil', 15), 'Manage')));

  if (!pinned.length) {
    card.append(emptyState('Pin bookmarks to see them here. Open Bookmarks and choose Pin.'));
    return card;
  }

  card.append(h('div', { class: 'shortcuts' }, pinned.map((item) => h('a', {
    class: 'shortcut', href: item.url, target: '_blank', rel: 'noopener noreferrer',
  }, icon('bookmarks', 16), h('span', { text: item.title })))));
  return card;
}

function recentNotesCard() {
  const recent = notes.recentNotes(4);
  const card = h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title', text: 'Recent notes' }),
      h('button', { class: 'btn btn-small', type: 'button', onClick: () => navigate('notes') }, icon('notes', 15), 'All notes')));

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
      h('h2', { class: 'card-title', text: 'Latest downloads' }),
      h('button', { class: 'btn btn-small', type: 'button', onClick: () => navigate('downloads') }, icon('downloads', 15), 'All downloads')));

  if (!latest.length) {
    card.append(emptyState('Nothing downloaded yet. Firefox saves files to SURGE/Downloads.'));
    return card;
  }

  card.append(h('ul', { class: 'mini-list' }, latest.map((entry) => h('li', {},
    h('button', {
      class: 'mini-item', type: 'button',
      onClick: () => api.open(`Downloads/${entry.name}`).catch(reportError),
    },
    h('span', { class: 'mini-title', text: entry.name }),
    h('span', { class: 'mini-meta', text: `${formatBytes(entry.size)} • ${relativeTime(entry.modified)}` }))))));
  return card;
}

function storageCard() {
  const storage = lastStatus?.storage;
  const card = h('section', { class: 'card' }, h('h2', { class: 'card-title', text: 'USB storage' }));
  if (!storage) {
    card.append(emptyState('Storage information is unavailable.'));
    return card;
  }
  card.append(
    h('p', { class: 'storage-big', text: `${formatBytes(storage.free)} free` }),
    h('p', { class: 'muted', text: `${formatBytes(storage.used)} used of ${formatBytes(storage.total)}` }),
    storage.critical
      ? h('div', { class: 'banner banner-error', role: 'alert' }, icon('warning'), h('div', {}, h('strong', { text: 'Almost full' }), h('p', { text: 'Delete files before saving anything else.' })))
      : storage.low
        ? h('div', { class: 'banner banner-warn', role: 'status' }, icon('warning'), h('div', {}, h('strong', { text: 'Running low' }), h('p', { text: 'Less than 1GB remains on this drive.' })))
        : h('p', { class: 'muted', text: 'Surge warns below 1GB and again below 500MB.' }));
  return card;
}

async function renderHome(target) {
  clear(target);
  target.append(
    h('section', { class: 'hero' },
      h('p', { class: 'eyebrow', text: 'YOUR PORTABLE WORKSPACE' }),
      h('h1', { class: 'hero-title', text: 'Welcome to Surge.' }),
      h('p', { class: 'hero-sub', text: 'Everything you need, wherever you go.' }),
      searchPanel()),
    h('div', { class: 'tiles' }, TILES.map((tile) => h('button', {
      class: 'tile', type: 'button', onClick: () => navigate(tile.route),
    }, icon(tile.icon, 22), h('span', { class: 'tile-title', text: tile.title }), h('span', { class: 'tile-sub', text: tile.sub })))),
    shortcutStrip(),
    h('div', { class: 'grid-2' }, recentNotesCard(), await latestDownloadsCard()),
    h('div', { class: 'grid-2' }, storageCard(),
      h('section', { class: 'card' },
        h('h2', { class: 'card-title', text: 'Travelling safely' }),
        h('p', { text: 'Your browser profile, notes, bookmarks, downloads and vault all live on this USB drive.' }),
        h('p', { class: 'muted', text: 'Close Firefox and safely eject the drive before unplugging it. Windows and the websites you visit may still leave traces on the host computer.' }))));

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
    toast('The Surge helper stopped. Close Firefox and start Surge.exe again.', 'error');
  });
  bus.addEventListener('restored-from-backup', () => toast('A damaged workspace file was recovered from its backup copy.', 'warn'));
  bus.addEventListener('notes-changed', () => { if (currentRoute === 'home') void renderHome(main); });
  bus.addEventListener('bookmarks-changed', () => { if (currentRoute === 'home') void renderHome(main); });

  window.addEventListener('hashchange', () => { void route(); });
  window.addEventListener('beforeunload', () => { void notes.flushPendingSave(); });

  await refreshStatus();
  setInterval(() => { void refreshStatus(); }, 20000);
  await route();
}

void boot();