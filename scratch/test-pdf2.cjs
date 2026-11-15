const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    webPreferences: {
      plugins: true,
      sandbox: true,
      contextIsolation: true,
    }
  });

  const pdfPath = path.resolve('build/SURGE/Browser/FirefoxPortable/App/Firefox64/browser/confused_fox.pdf');
  const fileUrl = 'file:///' + pdfPath.replace(/\\/g, '/');

  await win.loadURL(`data:text/html,<html><body><iframe src="${fileUrl}" style="width:100%;height:100%;"></iframe></body></html>`);
  
  win.webContents.on('console-message', (e, level, message) => {
    console.log('CONSOLE:', message);
  });

  setTimeout(() => {
    console.log('Test completed.');
    app.quit();
  }, 3000);
});
