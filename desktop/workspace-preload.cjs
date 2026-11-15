const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('surgeDesktop', {
  openBrowser: (url = '') => ipcRenderer.invoke('surge:open-browser', url),
  chooseVaultExport: (name) => ipcRenderer.invoke('surge:choose-vault-export', name),
  writeVaultExport: (ticket, bytes) => ipcRenderer.invoke('surge:write-vault-export', ticket, bytes),
  cancelVaultExport: () => ipcRenderer.invoke('surge:cancel-vault-export'),
  onNavigate: (callback) => ipcRenderer.on('surge:navigate', (_event, route) => callback(route)),
  vpnState: () => ipcRenderer.invoke('surge:vpn-state'),
  vpnApply: (config) => ipcRenderer.invoke('surge:vpn-apply', config),
  biometricIsAvailable: () => ipcRenderer.invoke('surge:biometric-is-available'),
  biometricIsEnrolled: () => ipcRenderer.invoke('surge:biometric-is-enrolled'),
  biometricEnroll: (password) => ipcRenderer.invoke('surge:biometric-enroll', password),
  biometricUnlock: () => ipcRenderer.invoke('surge:biometric-unlock'),
  biometricRemove: () => ipcRenderer.invoke('surge:biometric-remove'),
});

