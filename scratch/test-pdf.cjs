const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    webPreferences: {
      plugins: true,
      sandbox: true,
      contextIsolation: true,
    }
  });
  console.log('plugins enabled:', win.webContents.getWebPreferences().plugins);
  app.quit();
});
