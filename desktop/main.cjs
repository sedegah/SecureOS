const { app, BrowserWindow, WebContentsView, session, ipcMain, dialog, safeStorage, nativeImage } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { webUrl, navigationTarget } = require('./navigation.cjs');

const isInstalled = app.isPackaged && !fs.existsSync(path.join(path.dirname(process.execPath), 'portable.flag'));
let root;
if (!app.isPackaged) {
  root = path.resolve(process.env.SURGE_DATA_ROOT || path.join(__dirname, '../build/SurgeDesktop-data'));
  fs.mkdirSync(root, { recursive: true });
  fs.cpSync(path.join(__dirname, '../interface'), path.join(root, 'Interface'), { recursive: true });
} else if (isInstalled) {
  root = path.join(app.getPath('appData'), 'Surge');
  fs.mkdirSync(root, { recursive: true });
  const appInterface = path.join(path.dirname(process.execPath), 'Interface');
  if (fs.existsSync(appInterface)) {
    fs.cpSync(appInterface, path.join(root, 'Interface'), { recursive: true });
  }
} else {
  root = path.dirname(process.execPath);
}
if (!fs.existsSync(root)) throw new Error('The Surge workspace is missing.');
const profile = path.join(root, 'Data', 'BrowserProfile');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.setPath('crashDumps', path.join(profile, 'CrashDumps'));
app.commandLine.appendSwitch('disk-cache-dir', path.join(profile, 'Cache'));
app.setName('Surge');
app.setAppUserModelId('Surge.Workspace');

const iconIco = path.join(__dirname, 'assets', 'icon.ico');
const iconPng = path.join(__dirname, 'assets', 'icon.png');
const appIcon = fs.existsSync(iconIco) ? nativeImage.createFromPath(iconIco) : (fs.existsSync(iconPng) ? nativeImage.createFromPath(iconPng) : undefined);

let helper, homeUrl, baseUrl, token, workspace, browserWindow, browserSession;
let appliedProxy = null;
let quitting = false;
let activeId = null;
let nextId = 1;
let downloadCount = 0;
const tabs = new Map();
const reservedDownloads = new Set();
const chromeFile = path.join(__dirname, 'browser', 'index.html');
const chromeUrl = pathToFileURL(chromeFile).href;

async function helperCall(method, endpoint, data) {
  const response = await fetch(baseUrl + endpoint, {
    method,
    headers: { 'X-Surge-Token': token, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404 && endpoint.startsWith('/api/doc/')) return null;
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || 'The workspace operation failed.');
  return result;
}

async function startHelper() {
  const executable = app.isPackaged ? path.join(process.resourcesPath, 'helper', 'Surge.exe') : path.join(__dirname, '../build/publish/Surge.exe');
  const helperArgs = ['--no-browser', '--root', root];
  if (isInstalled) helperArgs.push('--installed');
  helper = spawn(executable, helperArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('The Surge storage helper did not start.')), 30000);
    helper.on('error', error => { clearTimeout(timer); reject(error); });
    helper.once('exit', () => { clearTimeout(timer); reject(new Error('The storage helper closed during startup.')); });
    helper.stdout.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/SURGE_URL=(\S+)/);
      if (!match) return;
      clearTimeout(timer);
      homeUrl = match[1];
      const url = new URL(homeUrl);
      baseUrl = url.origin;
      token = new URLSearchParams(url.hash.slice(1)).get('k');
      resolve();
    });
    helper.stderr.on('data', () => {});
  });
  helper.on('exit', () => {
    if (!quitting) {
      dialog.showErrorBox('Surge storage unavailable', 'The storage helper stopped. Close Surge and reconnect the drive before continuing.');
      app.quit();
    }
  });
}

function requireWorkspace(event) {
  if (!workspace || event.sender !== workspace.webContents || event.senderFrame !== workspace.webContents.mainFrame || new URL(event.senderFrame.url).origin !== baseUrl)
    throw new Error('This action is only available from the Surge workspace.');
}

function requireChrome(event) {
  if (!browserWindow || event.sender !== browserWindow.webContents || event.senderFrame !== browserWindow.webContents.mainFrame || event.senderFrame.url !== chromeUrl)
    throw new Error('This action is only available from Surge Browser controls.');
}

function state() {
  return { activeId, downloadCount, tabs: [...tabs.values()].filter(tab => !tab.view.webContents.isDestroyed()).map(tab => {
    const wc = tab.view.webContents;
    return { id: tab.id, title: tab.title, url: tab.url, error: tab.error, loading: wc.isLoading(), canBack: wc.navigationHistory.canGoBack(), canForward: wc.navigationHistory.canGoForward() };
  }) };
}

function publish() {
  if (browserWindow && !browserWindow.isDestroyed()) browserWindow.webContents.send('surge:browser-state', state());
}

function layout() {
  if (!browserWindow) return;
  const [width, height] = browserWindow.getContentSize();
  for (const tab of tabs.values()) {
    tab.view.setBounds({ x: 0, y: 88, width, height: Math.max(0, height - 88) });
    tab.view.setVisible(tab.id === activeId && Boolean(tab.url));
  }
}

function selectTab(id) {
  if (!tabs.has(id)) throw new Error('This tab is no longer open.');
  activeId = id;
  layout();
  const tab = tabs.get(id);
  if (tab.url) tab.view.webContents.focus();
  else browserWindow.webContents.focus();
  publish();
}

async function navigate(tab, input) {
  const settings = await helperCall('GET', '/api/doc/settings') || {};
  const target = navigationTarget(input, settings.searchEngine);
  tab.error = '';
  tab.url = target;
  tab.title = target ? new URL(target).hostname : 'New tab';
  layout();
  publish();
  try { await tab.view.webContents.loadURL(target || 'about:blank'); }
  catch (error) {
    if (!tab.view.webContents.isDestroyed() && error.code !== 'ERR_ABORTED') {
      tab.error = 'This page could not be loaded. Check the address and connection.';
      publish();
    }
  }
}

function createTab(url = '') {
  if (tabs.size >= 30) throw new Error('Close a tab before opening more than 30 tabs.');
  const view = new WebContentsView({ webPreferences: { session: browserSession, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false } });
  const tab = { id: nextId++, view, title: 'New tab', url: '', error: '' };
  tabs.set(tab.id, tab);
  browserWindow.contentView.addChildView(view);
  const wc = view.webContents;
  wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  wc.setWindowOpenHandler(({ url: target }) => {
    if (webUrl(target)) { try { createTab(target); } catch {} }
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, target) => { if (!webUrl(target)) event.preventDefault(); });
  wc.on('will-redirect', (event, target) => { if (!webUrl(target)) event.preventDefault(); });
  wc.on('page-title-updated', (_event, title) => { tab.title = title.slice(0, 200); publish(); });
  wc.on('did-navigate', (_event, target) => { tab.url = target === 'about:blank' ? '' : target; tab.error = ''; publish(); });
  wc.on('did-navigate-in-page', (_event, target, mainFrame) => { if (mainFrame) { tab.url = target; publish(); } });
  wc.on('did-start-loading', publish);
  wc.on('did-stop-loading', publish);
  wc.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
    if (mainFrame && code !== -3) { tab.error = 'Page unavailable. Check the address, proxy and network.'; publish(); }
  });
  wc.on('render-process-gone', () => { tab.error = 'This tab stopped responding. Reload to recover it.'; publish(); });
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.control && ['l', 't', 'w'].includes(input.key.toLowerCase())) {
      event.preventDefault();
      if (input.key.toLowerCase() === 't') createTab();
      else if (input.key.toLowerCase() === 'w') closeTab(tab.id);
      else { browserWindow.webContents.focus(); browserWindow.webContents.send('surge:focus-address'); }
    }
  });
  selectTab(tab.id);
  if (url) void navigate(tab, url).catch(error => { tab.error = error.message; publish(); });
  return tab;
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  browserWindow.contentView.removeChildView(tab.view);
  tabs.delete(id);
  tab.view.webContents.close();
  if (!tabs.size) createTab();
  else if (activeId === id) selectTab([...tabs.keys()].at(-1));
  publish();
}

async function openBrowser(url = '') {
  if (typeof url !== 'string' || (url && !webUrl(url))) throw new Error('Only HTTP and HTTPS websites can be opened.');
  if (!browserWindow) {
    browserWindow = new BrowserWindow({ title: 'Surge Browser', width: 1280, height: 850, minWidth: 720, minHeight: 480, backgroundColor: '#f0f0f0', autoHideMenuBar: true,
      icon: appIcon,
      webPreferences: { preload: path.join(__dirname, 'browser-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    browserWindow.removeMenu();
    browserWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    browserWindow.webContents.on('will-navigate', event => event.preventDefault());
    browserWindow.on('resize', layout);
    browserWindow.on('closed', () => {
      for (const tab of tabs.values()) if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
      tabs.clear(); activeId = null; browserWindow = null;
      if (workspace && !workspace.isDestroyed()) workspace.show();
    });
    await browserWindow.loadFile(chromeFile);
    createTab(url);
  } else if (url || !tabs.size) createTab(url);
  browserWindow.show();
  browserWindow.focus();
  return { ok: true };
}

function installDownloads() {
  browserSession.on('will-download', (_event, item) => {
    const directory = path.join(root, 'Downloads');
    if (!fs.existsSync(root) || !fs.existsSync(directory) || fs.lstatSync(directory).isSymbolicLink()) { item.cancel(); return; }
    let name = path.basename(item.getFilename()).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 180);
    if (!name || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = 'download';
    const extension = path.extname(name), stem = path.basename(name, extension);
    let destination = path.join(directory, name), suffix = 1;
    while (fs.existsSync(destination) || reservedDownloads.has(destination)) destination = path.join(directory, `${stem} (${suffix++})${extension}`);
    reservedDownloads.add(destination);
    item.setSavePath(destination);
    downloadCount += 1;
    publish();
    item.on('updated', () => { if (!fs.existsSync(root)) item.cancel(); });
    item.once('done', (_event, result) => {
      reservedDownloads.delete(destination);
      downloadCount -= 1;
      publish();
      if (result !== 'completed' && !quitting) void dialog.showMessageBox(browserWindow || workspace, { type: 'warning', message: 'Download did not finish', detail: 'Check your connection and available USB space, then try again.' });
    });
  });
}

async function configureProxy(config) {
  const requested = config.enabled || config.autoConnect;
  const server = config.servers?.find(entry => entry.id === config.serverId);
  if (requested && !server && config.failClosed) {
    await browserSession.setProxy({ mode: 'fixed_servers', proxyRules: 'socks5://127.0.0.1:9', proxyBypassRules: '<-loopback>' });
  } else if (requested && server) {
    const host = server.host.includes(':') ? `[${server.host}]` : server.host;
    await browserSession.setProxy({ mode: 'fixed_servers', proxyRules: `${server.scheme}://${host}:${server.port}`, proxyBypassRules: '<-loopback>' });
  } else await browserSession.setProxy({ mode: 'direct' });
  await browserSession.closeAllConnections();
  appliedProxy = { ...config, active: Boolean(requested && (server || config.failClosed)), blocked: Boolean(requested && !server && config.failClosed), server: server || null };
}

async function proxyState() {
  return { ...appliedProxy, browserRunning: Boolean(browserWindow), engine: 'chromium', verified: false };
}

let vaultExport = null;
let exportRevision = 0;
ipcMain.handle('surge:choose-vault-export', async (event, name) => {
  requireWorkspace(event);
  if (typeof name !== 'string' || !name || name.length > 255) throw new Error('Invalid export filename.');
  const revision = ++exportRevision;
  vaultExport = null;
  const safeName = path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '') || 'export';
  const choice = await dialog.showSaveDialog(workspace, {
    title: 'Export an unencrypted copy', defaultPath: path.join(root, 'Downloads', safeName),
    buttonLabel: 'Export unencrypted copy', properties: ['showOverwriteConfirmation'],
  });
  if (choice.canceled || !choice.filePath || revision !== exportRevision) return null;
  const resolved = path.resolve(choice.filePath);
  if (!isInstalled) {
    const relative = path.relative(root, resolved).replaceAll('\\', '/');
    if (/^(Data|Interface|resources|locales)(\/|$)/i.test(relative) || (relative === path.basename(relative) && relative !== '..'))
      throw new Error('Choose Downloads or a folder outside the Surge runtime and data folders.');
  }
  vaultExport = { ticket: randomUUID(), destination: resolved, expires: Date.now() + 60000 };
  return vaultExport.ticket;
});
ipcMain.handle('surge:cancel-vault-export', event => {
  requireWorkspace(event);
  exportRevision += 1;
  vaultExport = null;
});
ipcMain.handle('surge:write-vault-export', async (event, ticket, bytes) => {
  requireWorkspace(event);
  const chosen = vaultExport;
  vaultExport = null;
  if (!chosen || chosen.ticket !== ticket || chosen.expires < Date.now()) throw new Error('Choose an export destination again.');
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 16 * 1024 * 1024) throw new Error('Invalid file export.');
  try {
    if (!fs.existsSync(root)) throw new Error('The Surge drive is no longer available.');
    for (let target = chosen.destination; ; target = path.dirname(target)) {
      if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('Exporting through linked paths is not supported.');
      if (path.dirname(target) === target) break;
    }
    await fs.promises.writeFile(chosen.destination, bytes);
    return { ok: true };
  } finally { bytes.fill(0); }
});

ipcMain.handle('surge:open-browser', async (event, url) => { requireWorkspace(event); return openBrowser(url); });
ipcMain.handle('surge:vpn-state', async event => { requireWorkspace(event); return proxyState(); });
ipcMain.handle('surge:vpn-apply', async (event, config) => {
  requireWorkspace(event);
  await helperCall('POST', '/api/vpn/apply', { ...config, confirm: true });
  const validated = await helperCall('GET', '/api/vpn/state');
  await configureProxy(validated);
  return proxyState();
});

const biometricPath = () => path.join(root, 'Data', 'PasswordVault', 'biometric.dat');

ipcMain.handle('surge:biometric-is-available', async (event) => {
  requireWorkspace(event);
  try {
    const status = await helperCall('GET', '/api/biometric/status');
    return Boolean(status?.available);
  } catch {
    return false;
  }
});

ipcMain.handle('surge:biometric-is-enrolled', async (event) => {
  requireWorkspace(event);
  return fs.existsSync(biometricPath());
});

ipcMain.handle('surge:biometric-enroll', async (event, password) => {
  requireWorkspace(event);
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) throw new Error('Biometric and credential protection is not available.');
  if (!password || typeof password !== 'string') throw new Error('Master password is required.');

  const verify = await helperCall('POST', '/api/biometric/verify', { message: 'Verify your fingerprint to enable biometric unlock for Surge Vault' });
  if (!verify?.verified) throw new Error('Fingerprint verification was cancelled or failed.');

  const file = biometricPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const encrypted = safeStorage.encryptString(password);
  fs.writeFileSync(file, encrypted);
  return true;
});

ipcMain.handle('surge:biometric-unlock', async (event) => {
  requireWorkspace(event);
  const file = biometricPath();
  if (!fs.existsSync(file)) throw new Error('No fingerprint or biometric credential enrolled.');

  const verify = await helperCall('POST', '/api/biometric/verify', { message: 'Scan your fingerprint to unlock Surge Vault' });
  if (!verify?.verified) throw new Error('Fingerprint verification was cancelled or failed.');

  const encrypted = fs.readFileSync(file);
  return safeStorage.decryptString(encrypted);
});

ipcMain.handle('surge:biometric-remove', async (event) => {
  requireWorkspace(event);
  const file = biometricPath();
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return true;
});

ipcMain.handle('surge:browser-command', async (event, action, payload = {}) => {
  requireChrome(event);
  try {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid browser command.');
    const tab = tabs.get(activeId);
    switch (action) {
      case 'state': break;
      case 'newTab': createTab(payload.url || ''); break;
      case 'selectTab': selectTab(payload.id); break;
      case 'closeTab': closeTab(payload.id); break;
      case 'navigate': if (tab) void navigate(tab, payload.url).catch(error => { tab.error = error.message; publish(); }); break;
      case 'back': if (tab?.view.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack(); break;
      case 'forward': if (tab?.view.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward(); break;
      case 'reload': tab?.view.webContents.reload(); break;
      case 'stop': tab?.view.webContents.stop(); break;
      case 'workspace': workspace.show(); workspace.focus(); break;
      case 'downloads': workspace.show(); workspace.focus(); workspace.webContents.send('surge:navigate', 'downloads'); break;
      default: throw new Error('Unknown browser action.');
    }
    return state();
  } catch (error) { return { ...state(), error: error.message }; }
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (workspace) { workspace.restore(); workspace.show(); workspace.focus(); } });
  app.whenReady().then(async () => {
    let splash = null;
    try {
      splash = new BrowserWindow({
        width: 640, height: 357, frame: false, transparent: true, resizable: false, center: true,
        show: true, alwaysOnTop: true, skipTaskbar: false,
        icon: appIcon,
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false }
      });
      await splash.loadFile(path.join(__dirname, 'splash.html'));
    } catch {}

    await startHelper();
    browserSession = session.fromPartition('persist:surge-web', { cache: true });
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    browserSession.setPermissionCheckHandler(() => false);
    installDownloads();
    await configureProxy(await helperCall('GET', '/api/vpn/state'));
    workspace = new BrowserWindow({ title: 'Surge Workspace', width: 1280, height: 850, minWidth: 760, minHeight: 520, backgroundColor: '#f0f0f0', autoHideMenuBar: true,
      show: false,
      icon: appIcon,
      webPreferences: { preload: path.join(__dirname, 'workspace-preload.cjs'), partition: 'surge-workspace', sandbox: true, contextIsolation: true, nodeIntegration: false, plugins: true } });
    workspace.removeMenu();
    const ALLOWED_WORKSPACE_PERMISSIONS = new Set(['clipboard-sanitized-write', 'publickey-credentials-get', 'publickey-credentials-create']);
    workspace.webContents.session.setPermissionRequestHandler((contents, permission, callback) => callback(contents === workspace?.webContents && ALLOWED_WORKSPACE_PERMISSIONS.has(permission)));
    workspace.webContents.session.setPermissionCheckHandler((contents, permission) => contents === workspace?.webContents && ALLOWED_WORKSPACE_PERMISSIONS.has(permission));
    workspace.webContents.setWindowOpenHandler(({ url }) => { if (webUrl(url)) void openBrowser(url).catch(error => dialog.showErrorBox('Cannot open browser', error.message)); return { action: 'deny' }; });
    workspace.webContents.on('will-navigate', (event, target) => {
      if (!target.startsWith(baseUrl + '/')) { event.preventDefault(); if (webUrl(target)) void openBrowser(target); }
    });
    workspace.webContents.on('will-attach-webview', event => event.preventDefault());
    workspace.on('close', () => { if (browserWindow) browserWindow.close(); });
    workspace.on('closed', () => { workspace = null; app.quit(); });
    await workspace.loadURL(homeUrl);
    setTimeout(() => {
      workspace.show();
      workspace.focus();
      if (splash && !splash.isDestroyed()) splash.close();
    }, 1200);
  }).catch(error => { dialog.showErrorBox('Surge could not start', error.message); app.quit(); });
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  quitting = true;
  if (helper && helper.exitCode === null) helper.kill();
});

