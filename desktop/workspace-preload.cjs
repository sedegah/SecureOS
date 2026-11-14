const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('surgeDesktop', {
  openBrowser: (url = '') => ipcRenderer.invoke('surge:open-browser', url),
  chooseVaultExport: (name) => ipcRenderer.invoke('surge:choose-vault-export', name),
  writeVaultExport: (ticket, bytes) => ipcRenderer.invoke('surge:write-vault-export', ticket, bytes),
  cancelVaultExport: () => ipcRenderer.invoke('surge:cancel-vault-export'),
  onNavigate: (callback) => ipcRenderer.on('surge:navigate', (_event, route) => callback(route)),
  onBookmark: (callback) => ipcRenderer.on('surge:add-bookmark', (_event, bookmark) => callback(bookmark)),
  vpnState: () => ipcRenderer.invoke('surge:vpn-state'),
  vpnApply: (config) => ipcRenderer.invoke('surge:vpn-apply', config),
});
