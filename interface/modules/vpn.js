import { api, bus } from './api.js';
import { h, clear, toast, reportError, cardLabel, switchRow, formDialog, confirmDialog, newId } from './ui.js';
import { icon } from './icons.js';

const DESKTOP_MESSAGE = 'Launch the standalone Surge desktop to configure browser proxy';
const hasDesktop = () => Boolean(window.surgeDesktop);
const selectedServer = () => config.servers.find((server) => server.id === config.serverId) ?? null;

let config = { enabled: false, autoConnect: false, failClosed: true, servers: [], serverId: null, server: null, active: false, blocked: false, browserRunning: false };
let hasSnapshot = false;
let statusKnown = false;
let lastError = '';
let revision = 0;
let pending = 0;
let disconnectQueued = false;
let operations = Promise.resolve();
let rerender = null;

export function currentState() {
  if (!hasDesktop()) return 'unavailable';
  if (!statusKnown) return 'unknown';
  if (config.blocked) return 'blocked';
  return config.active ? 'unverified' : 'disconnected';
}

export function isProtected() {

  return false;
}

function notify() {
  rerender?.();
  bus.dispatchEvent(new CustomEvent('vpn-changed', { detail: { state: currentState() } }));
}

function serverFields(server) {
  return { id: server.id, name: server.name, scheme: server.scheme, host: server.host, port: server.port };
}

function acceptState(next) {
  if (next?.engine !== 'chromium' || !Array.isArray(next.servers)
    || ['enabled', 'autoConnect', 'failClosed', 'active', 'blocked', 'browserRunning'].some((key) => typeof next[key] !== 'boolean')) {
    throw new Error('The standalone browser did not return its applied Chromium proxy state.');
  }
  config = {
    engine: next.engine,
    enabled: next.enabled,
    autoConnect: next.autoConnect,
    failClosed: next.failClosed,
    servers: next.servers.map(serverFields),
    serverId: next.serverId ?? null,
    server: next.server ? serverFields(next.server) : null,
    active: next.active,
    blocked: next.blocked,
    browserRunning: next.browserRunning,
    verified: false,
  };
  hasSnapshot = true;
  statusKnown = true;
}

function storedConfig(patch) {
  const next = { ...config, ...patch };
  return {
    version: 1,
    enabled: Boolean(next.enabled),
    autoConnect: Boolean(next.autoConnect),
    failClosed: Boolean(next.failClosed),
    serverId: next.serverId ?? null,
    servers: next.servers.map(serverFields),
  };
}

export async function load() {
  if (!hasDesktop()) {
    statusKnown = false;
    notify();
    return;
  }

  if (pending) {
    await operations;
    return;
  }
  const ticket = ++revision;
  try {
    const next = await api.vpnState();
    if (ticket !== revision) return;
    acceptState(next);
    lastError = '';
  } catch (error) {
    if (ticket !== revision) return;
    statusKnown = false;
    lastError = error?.message ?? 'Could not read the browser proxy state.';
  }
  notify();
}

export async function start() {
  await load();
}

export function pill(onNavigate) {
  const state = currentState();
  const text = state === 'blocked' ? 'Browsing blocked'
    : state === 'unverified' ? 'Proxy on (not verified)'
      : state === 'unknown' ? 'Proxy status unavailable' : 'Proxy off';
  return h('button', {
    class: `vpn-pill${state === 'blocked' ? ' fault' : ''}`, type: 'button', onClick: onNavigate,
    'aria-label': `${text}. ${state === 'unavailable' ? DESKTOP_MESSAGE : 'Open browser proxy settings.'}`,
  }, h('span', { class: `vpn-dot${state === 'blocked' ? ' fail' : state === 'unverified' ? ' pend' : ''}` }), text);
}

function apply(patch, message, disconnecting = false) {
  if (!hasDesktop()) {
    toast(DESKTOP_MESSAGE, 'error');
    return Promise.resolve(false);
  }
  if (disconnecting ? disconnectQueued : pending > 0) return Promise.resolve(false);
  if (disconnecting) disconnectQueued = true;
  pending += 1;
  revision += 1;
  lastError = '';

  operations = operations.then(async () => {
    try {
      if (!hasSnapshot) acceptState(await api.vpnState());
      const changes = typeof patch === 'function' ? patch() : patch;
      acceptState(await api.vpnApply(storedConfig(changes)));
      lastError = '';
      toast(message);
      return true;
    } catch (error) {
      lastError = error?.message ?? 'Could not apply browser proxy settings.';

      try {
        acceptState(await api.vpnState());
      } catch {
        statusKnown = false;
      }
      reportError(error);
      return false;
    } finally {
      pending -= 1;
      if (disconnecting) disconnectQueued = false;
      notify();
    }
  });
  rerender?.();
  return operations;
}

async function connect() {
  if (pending) return;
  if (!selectedServer()) {
    toast('Add and select a proxy server first.', 'error');
    return;
  }
  await apply(() => ({ enabled: true, serverId: config.serverId }), 'Browser proxy settings applied. Not independently verified.');
}

async function disconnect() {

  await apply({ enabled: false, autoConnect: false }, 'Proxy disabled and auto-connect switched off.', true);
}

async function chooseServer(server) {
  if (pending || server.id === config.serverId) return;
  await apply({ serverId: server.id }, 'Server selection applied to the browser.');
}

async function editServer(existing) {
  if (pending) return;
  const values = await formDialog({
    title: existing ? 'Edit proxy server' : 'Add proxy server',
    message: 'Bring your own SOCKS5 or HTTPS proxy. Authentication-requiring proxies are not supported yet; credentials are not stored. Changes to the active server apply immediately.',
    confirmLabel: existing ? 'Save server' : 'Add server',
    fields: [
      { name: 'name', label: 'Name', value: existing?.name ?? '', placeholder: 'Home proxy', required: true },
      { name: 'scheme', label: 'Type', type: 'select', value: existing?.scheme ?? 'socks5', options: [{ value: 'socks5', label: 'SOCKS5' }, { value: 'https', label: 'HTTPS' }] },
      { name: 'host', label: 'Host', value: existing?.host ?? '', placeholder: 'proxy.example.com', hint: 'Hostname or IP address only; no URL, username or password.', required: true },
      { name: 'port', label: 'Port', type: 'number', value: existing ? String(existing.port) : '1080', required: true },
    ],
  });
  if (!values) return;

  const name = values.name.trim();
  let host = values.host.trim();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  const port = Number(values.port);
  if (!name || !host || /[\s/@?#\\]/.test(host)) {
    toast('Enter a name and a host without a URL, path or credentials.', 'error');
    return;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    toast('The port must be a whole number between 1 and 65535.', 'error');
    return;
  }
  if (!['socks5', 'https'].includes(values.scheme)) {
    toast('Choose SOCKS5 or HTTPS.', 'error');
    return;
  }

  const server = { id: existing?.id ?? newId(), name, scheme: values.scheme, host, port };
  await apply(() => {
    if (existing && !config.servers.some((entry) => entry.id === existing.id)) {
      throw new Error('This server was removed. Add it again instead.');
    }
    const servers = existing ? config.servers.map((entry) => entry.id === server.id ? server : entry) : [...config.servers, server];
    return { servers, serverId: selectedServer()?.id ?? server.id };
  }, 'Proxy server saved and browser settings applied.');
}

async function removeServer(server) {
  if (pending) return;
  const ok = await confirmDialog({
    title: 'Remove this proxy server?',
    message: `Remove "${server.name}"? Removing the selected server also disconnects the proxy and switches off auto-connect. This does not change your provider account.`,
    confirmLabel: 'Remove', danger: true,
  });
  if (!ok) return;
  await apply(() => {
    const servers = config.servers.filter((entry) => entry.id !== server.id);
    return server.id === config.serverId
      ? { servers, serverId: servers[0]?.id ?? null, enabled: false, autoConnect: false }
      : { servers };
  }, 'Proxy server removed and browser settings applied.');
}

async function setAutoConnect(value) {
  if (value && !selectedServer()) {
    toast('Add and select a proxy server before enabling auto-connect.', 'error');
    rerender?.();
    return;
  }
  await apply({ autoConnect: value }, 'Auto-connect setting applied.');
}

function serverAddress(server) {
  if (!server) return 'None';
  const host = server.host.includes(':') && !server.host.startsWith('[') ? `[${server.host}]` : server.host;
  return `${server.scheme.toUpperCase()} · ${host}:${server.port}`;
}

function serverList() {
  const list = h('div', { class: 'vpn-servers' });
  if (!config.servers.length) {
    list.append(h('p', { class: 'empty', text: 'No proxy servers yet. Add a SOCKS5 or HTTPS proxy you run or obtain from a provider. Surge does not bundle a provider.' }));
    return list;
  }
  for (const server of config.servers) {
    const selected = server.id === config.serverId;
    list.append(h('div', { class: `vpn-server${selected ? ' selected' : ''}` },
      h('button', {
        class: 'vpn-server-main', type: 'button', disabled: pending > 0 || !statusKnown,
        'aria-pressed': String(selected), 'aria-label': `Select ${server.name}, ${serverAddress(server)}`,
        onClick: () => { void chooseServer(server); },
      },
      h('span', { class: 'vpn-server-name', text: `${server.name}${selected ? ' (selected)' : ''}` }),
      h('span', { class: 'vpn-server-addr', text: serverAddress(server), title: serverAddress(server) })),
      h('button', { class: 'btn btn-small btn-icon', type: 'button', disabled: pending > 0 || !statusKnown, 'aria-label': `Edit ${server.name}`, onClick: () => { void editServer(server); } }, icon('pencil', 15)),
      h('button', { class: 'btn btn-small btn-icon btn-danger', type: 'button', disabled: pending > 0 || !statusKnown, 'aria-label': `Remove ${server.name}`, onClick: () => { void removeServer(server); } }, icon('trash', 15))));
  }
  return list;
}

function powerPanel() {
  const state = currentState();
  const blocked = state === 'blocked';
  const active = state === 'unverified';
  const heading = blocked ? 'Browsing blocked' : active ? 'Proxy configured — not independently verified'
    : state === 'unknown' ? 'Proxy status unavailable' : 'Disconnected';
  const description = blocked ? 'Chromium reports browser requests blocked. Select a usable server and connect, or disconnect to allow direct browsing.'
    : active ? 'The proxy settings are applied to Surge Browser. This does not confirm the proxy is reachable or that requests use it successfully.'
      : state === 'unknown' ? 'The applied browser state could not be read. Refresh the status or try disconnecting; do not assume the proxy is off.'
        : 'No proxy is active in the Surge Browser session. Select your own server to connect.';

  return h('section', { class: 'card vpn-power' },
    icon('vpn', 32),
    h('span', { class: `vpn-badge${blocked ? ' fault' : active ? ' busy' : ''}`, role: 'status', text: blocked ? 'Browsing blocked' : active ? 'Proxy on (not verified)' : state === 'unknown' ? 'Status unavailable' : 'Proxy off' }),
    h('div', {}, h('h2', { class: 'vpn-head', text: heading }), h('p', { class: 'vpn-sub', text: description })),
    h('p', { class: 'vpn-detail', text: `Selected server: ${serverAddress(selectedServer())}` }),
    active ? h('p', { class: 'vpn-detail', text: `Applied proxy: ${serverAddress(config.server)}` }) : null,
    h('button', {
      class: 'vpn-power-btn', type: 'button', disabled: pending > 0 || !statusKnown || !selectedServer() || active,
      onClick: () => { void connect(); },
    }, icon('power', 20), 'Connect proxy'),
    h('button', {
      class: 'vpn-power-btn', type: 'button',
      onClick: () => { void disconnect(); },
    }, icon('power', 20), disconnectQueued ? 'Disconnect queued' : 'Disconnect proxy'),
    h('p', { class: 'hint', text: 'Disconnect also turns off auto-connect and allows direct browser connections.' }),
    pending ? h('p', { class: 'hint', role: 'status', text: 'Applying browser proxy settings…' }) : null,
    lastError ? h('div', { class: 'banner banner-error', role: 'alert', text: `Proxy operation failed: ${lastError}` }) : null,
    h('button', { class: 'btn btn-small', type: 'button', disabled: pending > 0, onClick: () => { void load(); } }, icon('refresh', 15), 'Refresh status'));
}

function render(target) {
  clear(target);
  target.append(h('header', { class: 'section-head' },
    h('div', {}, h('h1', {}, icon('vpn', 20), ' Browser proxy'), h('p', { class: 'section-sub', text: 'Bring your own proxy · Standalone Chromium Surge Browser' })),
    h('span', { class: 'chip chip-quiet', text: 'BROWSER ONLY · CHROMIUM' })));

  if (!hasDesktop()) {
    target.append(h('section', { class: 'card' }, cardLabel('Standalone desktop required'), h('p', { text: DESKTOP_MESSAGE })));
    return;
  }

  const disabled = pending > 0 || !statusKnown;
  target.append(h('div', { class: 'vpn-layout' },
    h('div', { class: 'stack' }, powerPanel()),
    h('div', { class: 'stack' },
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, cardLabel('Proxy servers'),
          h('button', { class: 'btn btn-small', type: 'button', disabled, onClick: () => { void editServer(null); } }, icon('plus', 15), 'Add server')),
        serverList(),
        h('p', { class: 'hint', text: 'Saving, selecting or editing a server applies the settings immediately. Existing browser connections are closed; no restart is required.' })),
      h('section', { class: 'card' },
        cardLabel('Settings'),
        switchRow({
          label: 'Auto-connect on start', checked: config.autoConnect, disabled,
          hint: 'Apply your proxy when Surge starts. Enabling this also applies it now.',
          onChange: (value) => { void setAutoConnect(value); },
        }),
        switchRow({
          label: 'Fail closed', checked: config.failClosed, disabled,
          hint: 'Block browsing when proxy use is requested without a selected server. This is not an independently verified leak safeguard.',
          onChange: (value) => { void apply({ failClosed: value }, 'Fail-closed setting applied.'); },
        }),
        h('div', { class: 'info-row' },
          h('span', { class: 'info-label', text: 'Chromium browser window' }),
          h('span', { class: 'info-value', text: statusKnown ? (config.browserRunning ? 'Open' : 'Closed') : 'Unknown' }))),
      h('section', { class: 'card' },
        cardLabel('Not independently verified'),
        h('p', { text: 'Status reports the proxy settings applied to the Chromium browser session, not a successful connection test. Surge does not currently perform live exit-IP, DNS, IPv6 or WebRTC leak checks.' }),
        h('p', { class: 'hint', text: 'Authentication-requiring proxies are not supported yet. Credentials are not stored; use a proxy that does not require a username or password.' })))));
  target.append(h('p', { class: 'vpn-foot', text: 'Browser-only proxy, not a system-wide VPN. Other apps are not covered. Surge does not bundle a proxy provider, promise anonymity or independently verify protection.' }));
}

export async function mount(target) {

  rerender = () => render(target);
  rerender();
  await load();
}

export function stop() {
  rerender = null;
}

