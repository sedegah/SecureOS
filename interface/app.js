import { initSession, api, bus } from './modules/api.js';
import { h, clear, toast, reportError, formatBytes, relativeTime, emptyState, cardLabel } from './modules/ui.js';
import { icon } from './modules/icons.js';
import * as settings from './modules/settings.js';
import * as notes from './modules/notes.js';
import * as files from './modules/files.js';
import * as downloads from './modules/downloads.js';
import * as passwords from './modules/passwords.js';
import * as vpn from './modules/vpn.js';

if (typeof window !== 'undefined' && window.location.hostname === '127.0.0.1') {
  const target = new URL(window.location.href);
  target.hostname = 'localhost';
  window.location.replace(target.href);
}

const ROUTES = [
  { id: 'home', label: 'Home', icon: 'home', mount: renderHome },
  { id: 'browser', label: 'Browser', icon: 'globe', mount: renderBrowserSection },
  { id: 'files', label: 'Files', icon: 'files', mount: files.mount },
  { id: 'notes', label: 'Notes', icon: 'notes', mount: notes.mount },
  { id: 'downloads', label: 'Downloads', icon: 'downloads', mount: downloads.mount },
  { id: 'passwords', label: 'Vault', icon: 'lock', mount: passwords.mount },
  { id: 'vpn', label: 'Browser proxy', icon: 'vpn', mount: vpn.mount },
  { id: 'settings', label: 'Settings', icon: 'settings', mount: settings.mount },
];

const TILES = [
  { route: 'browser', icon: 'globe', title: 'Surge Browser', sub: 'Open the web browser' },
  { route: 'files', icon: 'files', title: 'My Files', sub: 'Documents and files' },
  { route: 'notes', icon: 'notes', title: 'My Notes', sub: 'Personal notes' },
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
  location.hash = `#/${route}`;
}

async function renderBrowserSection(target) {
  clear(target);
  const isDesktop = Boolean(window.surgeDesktop);

  function launchUrl(rawUrl) {
    let url = (rawUrl || '').trim();
    if (!url) {
      if (isDesktop) void window.surgeDesktop.openBrowser().catch(reportError);
      else window.open('https://duckduckgo.com', '_blank');
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      if (url.includes('.') && !url.includes(' ')) {
        url = 'https://' + url;
      } else {
        url = 'https://duckduckgo.com/?q=' + encodeURIComponent(url);
      }
    }
    if (isDesktop) {
      void window.surgeDesktop.openBrowser(url).catch(reportError);
    } else {
      window.open(url, '_blank');
    }
  }

  const urlInput = h('input', {
    type: 'text',
    class: 'browser-hub-input',
    placeholder: 'Search the web or enter address (e.g. duckduckgo.com)...',
    onKeydown: (e) => {
      if (e.key === 'Enter') {
        launchUrl(urlInput.value);
      }
    }
  });

  const launchBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    onClick: () => launchUrl(urlInput.value)
  }, icon('right'), 'Go');

  const searchBox = h('div', { class: 'browser-search-card' },
    h('div', { class: 'browser-hub-section-label', text: 'Web Address & Search Launcher' }),
    h('div', { class: 'browser-search-form' },
      h('div', { class: 'browser-search-input-wrap' },
        icon('search'),
        urlInput
      ),
      launchBtn
    )
  );

  const quickPills = [
    { label: 'DuckDuckGo', url: 'https://duckduckgo.com', desc: 'Privacy search' },
    { label: 'Wikipedia', url: 'https://wikipedia.org', desc: 'Encyclopedia' },
    { label: 'EFF', url: 'https://www.eff.org', desc: 'Digital rights' },
    { label: 'Archive.org', url: 'https://archive.org', desc: 'Wayback Machine' },
    { label: 'GitHub', url: 'https://github.com', desc: 'Code repository' },
    { label: 'Proton Mail', url: 'https://mail.proton.me', desc: 'Encrypted mail' },
  ];

  const quickLinksRow = h('div', { class: 'browser-shortcuts-grid' },
    quickPills.map(item =>
      h('button', {
        class: 'browser-shortcut-btn',
        type: 'button',
        onClick: () => launchUrl(item.url),
      },
        h('div', { class: 'browser-shortcut-icon' }, icon('globe')),
        h('div', { class: 'browser-shortcut-meta' },
          h('span', { class: 'browser-shortcut-name', text: item.label }),
          h('span', { class: 'browser-shortcut-desc', text: item.desc })
        )
      )
    )
  );

  const features = h('div', { class: 'browser-features-grid' },
    h('div', { class: 'browser-feature-box' },
      h('div', { class: 'browser-feature-header' },
        icon('shield'),
        h('h3', { text: 'Zero Host Footprint' })
      ),
      h('p', { text: 'Browser profiles, cache, session storage, and cookies live exclusively on your secure portable volume, leaving no artifacts on host computers.' })
    ),
    h('div', { class: 'browser-feature-box' },
      h('div', { class: 'browser-feature-header' },
        icon('globe'),
        h('h3', { text: 'Sandboxed Chromium Runtime' })
      ),
      h('p', { text: 'Runs isolated with multi-process tab sandboxing, strict origin boundaries, and independent GPU rendering decoupled from OS defaults.' })
    ),
    h('div', { class: 'browser-feature-box' },
      h('div', { class: 'browser-feature-header' },
        icon('lock'),
        h('h3', { text: 'SOCKS5 & Leak Protection' })
      ),
      h('p', { text: 'All navigation adheres to configured proxy tunneling rules, automatically dropping unencrypted traffic when fail-closed kill switch is engaged.' })
    )
  );

  const statusBar = h('div', { class: 'browser-status-bar' },
    h('div', { class: 'browser-status-text' },
      h('span', { class: 'status-dot online' }),
      h('span', { text: 'Chromium Engine Ready • Isolated Profile • Direct USB Downloads Active' })
    ),
    h('div', { class: 'browser-status-actions' },
      h('button', {
        class: 'btn btn-secondary btn-small',
        type: 'button',
        onClick: () => { location.hash = '#/vpn'; }
      }, icon('vpn'), 'Proxy Settings'),
      h('button', {
        class: 'btn btn-secondary btn-small',
        type: 'button',
        onClick: () => { location.hash = '#/downloads'; }
      }, icon('downloads'), 'Downloads')
    )
  );

  const hubContainer = h('div', { class: 'browser-hub' },
    searchBox,
    h('div', { class: 'browser-hub-section-label', text: 'Quick Launch Shortcuts' }),
    quickLinksRow,
    h('div', { class: 'browser-hub-section-label', text: 'Privacy & Architecture' }),
    features,
    statusBar
  );

  target.append(
    h('header', { class: 'section-head' },
      h('div', {},
        h('h1', { text: 'Surge Browser' }),
        h('p', { class: 'section-sub', text: 'Independent Chromium browser with isolated profiles, USB downloads, and proxy support.' })),
      h('div', { class: 'section-actions' },
        h('button', {
          class: 'btn btn-primary', type: 'button',
          onClick: () => launchUrl(''),
        }, icon('globe'), isDesktop ? 'Open Browser Window' : 'Launch Browser Window'))),
    hubContainer
  );
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

function initClock() {
  const clockEl = document.getElementById('status-clock');
  if (!clockEl) return;
  const update = () => {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  update();
  setInterval(update, 1000);
}

function updateStorage(status) {
  const storage = status?.storage;
  const block = document.getElementById('storage');
  const chip = document.getElementById('usb-chip');
  const label = document.getElementById('storage-label');
  if (label) label.textContent = status?.installed ? 'Disk' : 'USB';

  if (status?.installed) {
    chip.className = 'chip chip-ok';
    chip.textContent = 'System ready';
  } else if (!status?.usbPresent) {
    chip.className = 'chip chip-error';
    chip.textContent = 'USB disconnected';
    block.hidden = true;
    showSpaceBanner(null);
    return;
  } else {
    chip.className = 'chip chip-ok';
    chip.textContent = 'USB ready';
  }

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
    await Promise.all([settings.loadSettings(), notes.loadNotes()]);
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
  bus.addEventListener('vpn-changed', refreshPill);
  bus.addEventListener('settings-changed', () => { void refreshStatus(); });

  window.surgeDesktop?.onNavigate((destination) => {
    if (ROUTES.some((entry) => entry.id === destination)) navigate(destination);
  });
  window.addEventListener('hashchange', () => { void route(); });
  window.addEventListener('beforeunload', () => { passwords.lock(); void notes.flushPendingSave().catch(() => {}); });

  initClock();
  await refreshStatus();
  setInterval(() => { void refreshStatus(); }, 20000);
  await route();
  await vpn.start();
  refreshPill();
}

void boot();
