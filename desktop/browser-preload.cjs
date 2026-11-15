const { contextBridge, ipcRenderer } = require('electron');

ipcRenderer.on('surge:focus-address', () => {
  const input = document.querySelector('input');
  input?.focus();
  input?.select();
});

contextBridge.exposeInMainWorld('surgeBrowser', {
  state: () => ipcRenderer.invoke('surge:browser-command', 'state'),
  command: (action, payload = {}) => ipcRenderer.invoke('surge:browser-command', action, payload),
  subscribe: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('surge:browser-state', listener);
    return () => ipcRenderer.removeListener('surge:browser-state', listener);
  },
});

