const base = process.env.REMOTEX_API_URL ?? "http://localhost:4000/api";
const email = `smoke-${Date.now()}@example.test`;
const password = "Correct-Horse-Battery-42!";
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"} ${label}`); if (!ok) failures++; };
async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) }
  });
  return { response, data: await response.json().catch(() => ({})) };
}

const health = await fetch(base.replace(/\/api$/, "") + "/health");
check(health.ok, "API health endpoint");
const noAuth = await request("/devices");
check(noAuth.response.status === 401, "device listing rejects unauthenticated request");
const registered = await request("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) });
check(registered.response.status === 201 && Boolean(registered.data.token), "user registration returns access token");
if (!registered.data.token) process.exit(1);
const token = registered.data.token;
const authHeader = { authorization: `Bearer ${token}` };
const created = await request("/devices", { method: "POST", headers: authHeader, body: JSON.stringify({ label: "Smoke test PC", platform: "windows" }) });
check(created.response.status === 201 && Boolean(created.data.deviceSecret), "device enrollment issues one-time pairing secret");
const deviceId = created.data.device?.id;
if (!deviceId) process.exit(1);
const listed = await request("/devices", { headers: authHeader });
check(listed.response.ok && listed.data.devices?.some(d => d.id === deviceId), "owner can list enrolled device");
const adminDenied = await request("/admin/overview", { headers: authHeader });
check(adminDenied.response.status === 403, "regular user cannot access admin API");

const paired = await request("/devices/pair", { method: "POST", body: JSON.stringify({ deviceId, pairingSecret: created.data.deviceSecret }) });
check(paired.response.ok && Boolean(paired.data.deviceToken) && Boolean(paired.data.refreshToken), "device can prove one-time pairing secret and receive scoped access/refresh tokens");
const replayPair = await request("/devices/pair", { method: "POST", body: JSON.stringify({ deviceId, pairingSecret: created.data.deviceSecret }) });
check(replayPair.response.status === 401, "pairing secret cannot be reused");
let currentDeviceToken = paired.data.deviceToken;
let currentRefreshToken = paired.data.refreshToken;
if (currentDeviceToken && currentRefreshToken) {
  const refresh = await request("/devices/refresh", { method: "POST", body: JSON.stringify({ deviceId, refreshToken: currentRefreshToken }) });
  check(refresh.response.ok && Boolean(refresh.data.refreshToken), "device refresh rotates the refresh token and issues a new access token");
  const replayRefresh = await request("/devices/refresh", { method: "POST", body: JSON.stringify({ deviceId, refreshToken: currentRefreshToken }) });
  check(replayRefresh.response.status === 401, "previous device refresh token cannot be replayed");
  if (refresh.response.ok) { currentDeviceToken = refresh.data.deviceToken; currentRefreshToken = refresh.data.refreshToken; }
  const heartbeat = await request("/devices/heartbeat", { method: "POST", headers: { authorization: `Bearer ${currentDeviceToken}` } });
  check(heartbeat.response.ok, "paired device token can submit heartbeat");
}
const revoked = await request(`/devices/${deviceId}/revoke`, { method: "POST", headers: authHeader });
check(revoked.response.ok, "owner can revoke enrolled device");
const after = await request("/devices", { headers: authHeader });
check(Boolean(after.data.devices?.find(d => d.id === deviceId)?.revoked_at), "revoked device is marked revoked");
if (currentDeviceToken) {
  const deadHeartbeat = await request("/devices/heartbeat", { method: "POST", headers: { authorization: `Bearer ${currentDeviceToken}` } });
  check(deadHeartbeat.response.status === 401, "revoked device token is rejected immediately");
}
if (failures) process.exitCode = 1;
else console.log("All API smoke checks passed.");
