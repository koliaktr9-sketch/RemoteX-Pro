const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('remoteX', {
  pair: (deviceId, pairingSecret) => ipcRenderer.invoke('agent:pair', { deviceId, pairingSecret }),
  restore: () => ipcRenderer.invoke('agent:restore'),
  disconnect: (forget) => ipcRenderer.invoke('agent:disconnect', { forget: Boolean(forget) }),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('agent:status', listener);
    return () => ipcRenderer.removeListener('agent:status', listener);
  }
});
