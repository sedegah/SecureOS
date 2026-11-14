const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron: electron } = require('../build/browser-tools/node_modules/playwright');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surge-desktop-test-'));
  const server = http.createServer((request, response) => {
    if (request.url === '/download') {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="test-download.txt"' });
      response.end('isolated download fixture');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(`<html><head><title>${request.url === '/two' ? 'Second page' : 'First page'}</title></head><body><a href="/two">Next page</a><a href="/download">Download</a></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let app;
  const errors = [];
  try {
    const env = { ...process.env, SURGE_DATA_ROOT: root };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath: path.resolve('desktop/node_modules/electron/dist/electron.exe'), args: [path.resolve('desktop')], env, timeout: 60000 });
    app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
    const workspace = await app.firstWindow();
    await workspace.locator('#open-surge-browser').waitFor({ state: 'visible', timeout: 30000 });
    assert.equal(await workspace.evaluate(() => typeof window.surgeDesktop.openBrowser), 'function');
    await workspace.screenshot({ path: path.join(root, 'workspace.png') });
    const opened = app.waitForEvent('window');
    await workspace.locator('#open-surge-browser').click();
    const browser = await opened;
    await browser.locator('#new-tab:not([disabled])').waitFor();
    await browser.locator('.tab').waitFor();
    assert.equal(await browser.locator('.tab').count(), 1);
    const address = `http://127.0.0.1:${server.address().port}`;
    await browser.locator('#address').fill(address);
    await browser.locator('#address').press('Enter');
    await browser.waitForFunction(() => document.querySelector('.tab-title')?.textContent === 'First page');
    const isolation = await app.evaluate(async ({ webContents }, target) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(target));
      return page.executeJavaScript('({require:typeof window.require,workspace:typeof window.surgeDesktop,chrome:typeof window.surgeBrowser})');
    }, address);
    assert.deepEqual(isolation, { require: 'undefined', workspace: 'undefined', chrome: 'undefined' });
    await browser.locator('#address').fill(address + '/two');
    await browser.locator('#address').press('Enter');
    await browser.waitForFunction(() => document.querySelector('.tab-title')?.textContent === 'Second page');
    await browser.locator('#back').click();
    await browser.waitForFunction(() => document.querySelector('.tab-title')?.textContent === 'First page');
    await browser.locator('#forward').click();
    await browser.waitForFunction(() => document.querySelector('.tab-title')?.textContent === 'Second page');
    await browser.locator('#bookmark').click();
    await workspace.locator('.nav-item[data-route="bookmarks"]').click();
    await workspace.getByRole('link', { name: 'Second page', exact: true }).waitFor();
    await browser.locator('#new-tab').click();
    assert.equal(await browser.locator('.tab').count(), 2);
    await browser.locator('.tab.active .tab-close').click();
    assert.equal(await browser.locator('.tab').count(), 1);
    await browser.locator('#address').fill(address + '/download');
    await browser.locator('#address').press('Enter');
    await workspace.waitForFunction(async () => {
      const { api } = await import('/modules/api.js');
      const listing = await api.listFiles('Downloads');
      return listing.entries.some(file => file.name === 'test-download.txt');
    });
    assert.equal(fs.readFileSync(path.join(root, 'Downloads/test-download.txt'), 'utf8'), 'isolated download fixture');
    await browser.locator('#downloads').click();
    await workspace.getByRole('heading', { name: 'Downloads', exact: true }).waitFor();
    await browser.screenshot({ path: path.join(root, 'browser.png') });
    assert.deepEqual(errors, []);
    console.log('PASS: home browser launch, navigation, back/forward, tabs, bookmarks, downloads and remote isolation.');
    console.log('Screenshots:', root);
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
