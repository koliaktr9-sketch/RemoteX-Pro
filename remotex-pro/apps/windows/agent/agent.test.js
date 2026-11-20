const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SecureTokenStore } = require('./secure-store');
const { DeviceAgent } = require('./device-agent');

function fakeSafeStorage() {
  return { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(Buffer.from(`enc:${s}`).toString('base64')), decryptString: b => { const s=Buffer.from(b.toString(),'base64').toString(); if(!s.startsWith('enc:')) throw Error('bad ciphertext'); return s.slice(4); } };
}
test('secure store encrypts, reloads and clears credentials', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rx-agent-'));
  const filePath = path.join(dir, 'credential.bin');
  const store = new SecureTokenStore({ safeStorage: fakeSafeStorage(), filePath });
  await store.save({ deviceId: 'dev-1', refreshToken: 'refresh-secret' });
  const bytes = await fs.readFile(filePath);
  assert.equal(bytes.toString().includes('refresh-secret'), false);
  assert.deepEqual(await store.load(), { deviceId: 'dev-1', refreshToken: 'refresh-secret' });
  await store.clear();
  assert.equal(await store.load(), null);
  await fs.rm(dir, { recursive: true, force: true });
});
test('secure store refuses plaintext fallback when OS encryption is unavailable', async () => {
  const store = new SecureTokenStore({ safeStorage: { isEncryptionAvailable: () => false }, filePath: '/tmp/should-not-write.bin' });
  await assert.rejects(store.save({ deviceId: 'x', refreshToken: 'y' }), /encryption is unavailable/);
});
test('pairing persists rotated refresh token and heartbeat uses device token', async () => {
  let saved;
  const calls = [];
  const store = { save: async r => { saved = r; }, load: async () => saved, clear: async () => { saved = null; } };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api/devices/pair')) return response({ deviceId: 'dev-1', deviceToken: 'access-1', refreshToken: 'refresh-1' });
    if (url.endsWith('/api/devices/heartbeat')) return response({ ok: true });
    throw Error(`unexpected ${url}`);
  };
  const agent = new DeviceAgent({ apiBase: 'http://localhost:4000', store, fetchImpl, heartbeatMs: 999999 });
  await agent.pair('dev-1', 'one-time-secret');
  assert.equal(saved.refreshToken, 'refresh-1');
  assert.equal(calls.filter(c => c.url.endsWith('/api/devices/heartbeat')).length, 1);
  assert.equal(calls[1].options.headers.authorization, 'Bearer access-1');
  await agent.disconnect();
});
test('refresh rotates and stores new token before heartbeat continues', async () => {
  let saved = { deviceId: 'dev-2', refreshToken: 'old-refresh' };
  const store = { save: async r => { saved = r; }, load: async () => saved, clear: async () => { saved = null; } };
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push({ url, options });
    if (url.endsWith('/api/devices/refresh')) return response({ deviceId: 'dev-2', deviceToken: 'access-2', refreshToken: 'new-refresh' });
    if (url.endsWith('/api/devices/heartbeat')) return response({ ok: true });
    throw Error('unexpected request');
  };
  const agent = new DeviceAgent({ apiBase: 'http://localhost:4000', store, fetchImpl });
  agent.record = saved;
  await agent.refresh();
  await agent.heartbeat();
  assert.equal(saved.refreshToken, 'new-refresh');
  assert.equal(seen[0].options.body.includes('old-refresh'), true);
  assert.equal(seen[1].options.headers.authorization, 'Bearer access-2');
});
test('server revocation response clears local credentials and stops agent', async () => {
  let saved = { deviceId: 'dev-3', refreshToken: 'refresh' };
  const store = { save: async r => { saved = r; }, load: async () => saved, clear: async () => { saved = null; } };
  const statuses = [];
  const fetchImpl = async () => response({ error: 'revoked' }, 401);
  const agent = new DeviceAgent({ apiBase: 'http://localhost:4000', store, fetchImpl, onStatus: s => statuses.push(s) });
  agent.record = saved; agent.accessToken = 'expired'; agent.stopped = false;
  await agent.tick();
  assert.equal(agent.stopped, true);
  assert.equal(saved, null);
  assert.equal(statuses.at(-1).state, 'revoked');
});
function response(data, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => data }; }

test('agent rejects non-HTTPS remote API endpoints', () => {
  const store = { save: async () => {}, load: async () => null, clear: async () => {} };
  assert.throws(() => new DeviceAgent({ apiBase: 'http://example.com', store }), /must use HTTPS/);
  assert.doesNotThrow(() => new DeviceAgent({ apiBase: 'http://localhost:4000', store }));
});
