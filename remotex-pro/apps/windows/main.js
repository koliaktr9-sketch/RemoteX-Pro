const { app, BrowserWindow, ipcMain, safeStorage, Notification, dialog } = require('electron');
const path = require('node:path');
const { SecureTokenStore } = require('./agent/secure-store');
const { DeviceAgent } = require('./agent/device-agent');

let mainWindow;
let agent;
function emitStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agent:status', status);
  if (status.state === 'revoked') new Notification({ title: 'RemoteX Pro device revoked', body: status.message }).show();
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900, height: 720, minWidth: 760, minHeight: 620, show: true,
    title: 'RemoteX Pro — Windows Agent', backgroundColor: '#101827',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('close', event => {
    if (agent && !agent.stopped) {
      event.preventDefault();
      dialog.showMessageBox(mainWindow, { type: 'warning', buttons: ['Keep Agent Open', 'Pause and Close'], defaultId: 0, cancelId: 0, title: 'RemoteX Pro is active', message: 'The device agent is connected.', detail: 'Keep the visible agent running, or pause its heartbeat before closing.' }).then(({ response }) => {
        if (response === 1) agent.disconnect().finally(() => { mainWindow.destroy(); });
      });
    }
  });
}
app.whenReady().then(async () => {
  const apiBase = process.env.REMOTEX_API_URL || 'http://localhost:4000';
  const store = new SecureTokenStore({ safeStorage, filePath: path.join(app.getPath('userData'), 'device-credentials.bin') });
  agent = new DeviceAgent({ apiBase, store, onStatus: emitStatus });
  ipcMain.handle('agent:pair', async (_event, data) => agent.pair(String(data.deviceId || '').trim(), String(data.pairingSecret || '').trim()));
  ipcMain.handle('agent:restore', () => agent.restore());
  ipcMain.handle('agent:disconnect', (_event, data) => agent.disconnect({ forget: data.forget }));
  createWindow();
  // No silent unattended operation: restoring only maintains an already paired device
  // heartbeat. It never starts capture, input control, or a remote session.
  await agent.restore();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (agent) agent.disconnect(); });
