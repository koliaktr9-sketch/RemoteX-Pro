class DeviceAgent {
  constructor({ apiBase, store, fetchImpl = fetch, onStatus = () => {}, heartbeatMs = 60_000 }) {
    const parsed = new URL(apiBase);
    const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !localHttp) throw new Error('RemoteX API must use HTTPS outside localhost.');
    this.apiBase = apiBase.replace(/\/$/, '');
    this.store = store;
    this.fetch = fetchImpl;
    this.onStatus = onStatus;
    this.heartbeatMs = heartbeatMs;
    this.record = null;
    this.accessToken = null;
    this.timer = null;
    this.busy = false;
    this.stopped = true;
  }
  async request(path, body, token) {
    const response = await this.fetch(`${this.apiBase}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || `API request failed (${response.status})`); error.status = response.status; throw error; }
    return data;
  }
  async pair(deviceId, pairingSecret) {
    if (!deviceId || !pairingSecret) throw new Error('Device ID and one-time pairing secret are required.');
    this.onStatus({ state: 'pairing', message: 'Pairing device…' });
    const result = await this.request('/api/devices/pair', { deviceId, pairingSecret });
    // Persist rotated credential before declaring pairing successful.
    const record = { deviceId: result.deviceId, refreshToken: result.refreshToken, pairedAt: new Date().toISOString() };
    await this.store.save(record);
    this.record = record;
    this.accessToken = result.deviceToken;
    this.stopped = false;
    await this.heartbeat();
    this.schedule();
    this.onStatus({ state: 'online', deviceId: this.record.deviceId, message: 'Paired. Device heartbeat active.' });
    return { deviceId: result.deviceId };
  }
  async restore() {
    const record = await this.store.load();
    if (!record) { this.onStatus({ state: 'unpaired', message: 'No paired device credentials found.' }); return false; }
    this.record = record;
    this.stopped = false;
    try {
      await this.refresh();
      await this.heartbeat();
      this.schedule();
      this.onStatus({ state: 'online', deviceId: record.deviceId, message: 'Secure device connection restored.' });
      return true;
    } catch (error) {
      if (error.status === 401) await this.invalidate('Device was revoked or refresh credentials are no longer valid. Re-enrollment is required.');
      else this.onStatus({ state: 'offline', message: `Cannot restore connection: ${error.message}` });
      return false;
    }
  }
  async refresh() {
    const result = await this.request('/api/devices/refresh', { deviceId: this.record.deviceId, refreshToken: this.record.refreshToken });
    const next = { ...this.record, refreshToken: result.refreshToken };
    // If this write fails, stop: old refresh token has already been consumed server-side.
    await this.store.save(next);
    this.record = next;
    this.accessToken = result.deviceToken;
  }
  async heartbeat() {
    if (!this.accessToken) await this.refresh();
    try {
      return await this.request('/api/devices/heartbeat', {}, this.accessToken);
    } catch (error) {
      if (error.status !== 401) throw error;
      await this.refresh();
      return this.request('/api/devices/heartbeat', {}, this.accessToken);
    }
  }
  schedule() {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), this.heartbeatMs);
  }
  async tick() {
    if (this.stopped || this.busy) return;
    this.busy = true;
    try {
      await this.heartbeat();
      this.onStatus({ state: 'online', deviceId: this.record.deviceId, message: 'Connected · heartbeat confirmed.' });
    } catch (error) {
      if (error.status === 401) await this.invalidate('Server rejected this device. It may have been revoked.');
      else this.onStatus({ state: 'offline', deviceId: this.record?.deviceId, message: `Network/API unavailable: ${error.message}` });
    } finally { this.busy = false; }
  }
  async invalidate(message) {
    this.stopTimers(); this.accessToken = null; this.record = null; this.stopped = true;
    await this.store.clear();
    this.onStatus({ state: 'revoked', message });
  }
  stopTimers() { clearInterval(this.timer); this.timer = null; }
  async disconnect({ forget = false } = {}) {
    this.stopped = true; this.stopTimers(); this.accessToken = null;
    if (forget) { this.record = null; await this.store.clear(); }
    this.onStatus({ state: 'stopped', message: forget ? 'Local device credentials erased.' : 'Agent paused.' });
  }
}
module.exports = { DeviceAgent };
