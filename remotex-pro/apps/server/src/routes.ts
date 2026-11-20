import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db } from "./db.js";
import {
  authenticate, authenticateDevice, requireAdmin, issueToken, issueDeviceToken, audit,
  newTotpSecret, totpUri, matchingTotpStep, consumeTotpStep, encryptMfaSecret, decryptMfaSecret
} from "./security.js";

export const api = Router();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// A dummy bcrypt hash keeps unknown-account login attempts on a comparable password-work path.
const dummyPasswordHash = bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);

api.post("/auth/register", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || Buffer.byteLength(password, "utf8") > 72)
    return res.status(400).json({ error: "Enter a valid email and a password of at least 12 characters and no more than 72 UTF-8 bytes." });
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await db.query("INSERT INTO users(email,password_hash,role) VALUES($1,$2,'user') RETURNING id,email,role,mfa_enabled", [email, hash]);
    const u = result.rows[0];
    await audit(u.id, "auth.registered");
    return res.status(201).json({ token: issueToken({ id: u.id, email: u.email, role: u.role, mfaEnabled: u.mfa_enabled }), user: { id: u.id, email: u.email, role: u.role, mfaEnabled: u.mfa_enabled } });
  } catch (e: any) {
    if (e.code === "23505") return res.status(409).json({ error: "An account with this email already exists." });
    return res.status(500).json({ error: "Registration failed." });
  }
});

api.post("/auth/login", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  const mfaCode = String(req.body?.mfaCode ?? "");
  if (Buffer.byteLength(password, "utf8") > 72) return res.status(401).json({ error: "Invalid email or password." });
  const result = await db.query("SELECT id,email,password_hash,role,mfa_enabled,mfa_secret FROM users WHERE email=$1", [email]);
  const u = result.rows[0];
  const passwordOk = await bcrypt.compare(password, u?.password_hash ?? await dummyPasswordHash);
  if (!u || !passwordOk) return res.status(401).json({ error: "Invalid email or password." });
  if (u.mfa_enabled) {
    if (!u.mfa_secret || !(await consumeTotpStep(u.id, decryptMfaSecret(u.mfa_secret), mfaCode)))
      return res.status(401).json({ error: "A valid, unused authenticator code is required.", mfaRequired: true });
  }
  await audit(u.id, "auth.login");
  return res.json({ token: issueToken({ id: u.id, email: u.email, role: u.role, mfaEnabled: u.mfa_enabled }), user: { id: u.id, email: u.email, role: u.role, mfaEnabled: u.mfa_enabled } });
});

api.get("/auth/me", authenticate, async (req, res) => {
  const r = await db.query("SELECT id,email,role,mfa_enabled,created_at FROM users WHERE id=$1", [req.auth!.id]);
  if (!r.rowCount) return res.status(401).json({ error: "Account no longer exists." });
  const u = r.rows[0];
  res.json({ user: { id: u.id, email: u.email, role: u.role, mfaEnabled: u.mfa_enabled, createdAt: u.created_at } });
});

api.post("/auth/mfa/setup", authenticate, async (req, res) => {
  const password = String(req.body?.password ?? "");
  const r = await db.query("SELECT password_hash,mfa_enabled FROM users WHERE id=$1", [req.auth!.id]);
  const user = r.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(403).json({ error: "Confirm your password to set up MFA." });
  if (user.mfa_enabled) return res.status(409).json({ error: "MFA is already enabled. Recovery or rotation must use a separately verified account-recovery flow." });
  const secretValue = newTotpSecret();
  await db.query("UPDATE users SET pending_mfa_secret=$1 WHERE id=$2", [encryptMfaSecret(secretValue), req.auth!.id]);
  res.json({ secret: secretValue, otpauthUrl: totpUri(req.auth!.email, secretValue), instructions: "Add this account to an authenticator app, then confirm with its current 6-digit code. Keep the secret private." });
});

api.post("/auth/mfa/confirm", authenticate, async (req, res) => {
  const code = String(req.body?.code ?? "");
  const r = await db.query("SELECT pending_mfa_secret FROM users WHERE id=$1", [req.auth!.id]);
  const encrypted = r.rows[0]?.pending_mfa_secret;
  if (!encrypted) return res.status(400).json({ error: "No MFA setup is pending." });
  const secretValue = decryptMfaSecret(encrypted);
  const step = matchingTotpStep(secretValue, code);
  if (step === null) return res.status(400).json({ error: "Invalid authenticator code." });
  const enabled = await db.query(
    "UPDATE users SET mfa_secret=pending_mfa_secret,pending_mfa_secret=NULL,mfa_enabled=TRUE,last_totp_step=$2 WHERE id=$1 AND pending_mfa_secret IS NOT NULL AND last_totp_step < $2 RETURNING id",
    [req.auth!.id, step]
  );
  if (!enabled.rowCount) return res.status(409).json({ error: "MFA setup was already completed or the code was already used." });
  await audit(req.auth!.id, "auth.mfa_enabled");
  res.json({ ok: true, message: "Multi-factor authentication enabled. Sign in again to obtain an MFA-authenticated session." });
});

// One-time pairing: the secret is consumed under a row lock and never stored in plaintext.
api.post("/devices/pair", async (req, res) => {
  const id = String(req.body?.deviceId ?? "").trim();
  const pairingSecret = String(req.body?.pairingSecret ?? "");
  if (!uuidPattern.test(id) || pairingSecret.length < 32 || pairingSecret.length > 128)
    return res.status(400).json({ error: "Provide a valid device ID and pairing secret." });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT id,owner_id,credential_hash,paired_at,revoked_at FROM devices WHERE id=$1 FOR UPDATE", [id]);
    const device = found.rows[0];
    if (!device || device.revoked_at || device.paired_at || !device.credential_hash || !(await bcrypt.compare(pairingSecret, device.credential_hash))) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "Invalid, expired, already used, or revoked pairing credentials." });
    }
    const refreshToken = crypto.randomBytes(32).toString("base64url");
    const refreshHash = await bcrypt.hash(refreshToken, 12);
    await client.query("UPDATE devices SET credential_hash=NULL,device_refresh_hash=$2,paired_at=NOW(),last_seen_at=NOW() WHERE id=$1", [id, refreshHash]);
    await client.query("INSERT INTO audit_events(actor_id,event_type,metadata_json) VALUES($1,$2,$3)", [device.owner_id, "device.paired", JSON.stringify({ deviceId: id })]);
    await client.query("COMMIT");
    return res.json({ deviceId: id, deviceToken: issueDeviceToken({ id, ownerId: device.owner_id }), refreshToken, expiresInSeconds: 600, warning: "Store the refresh token in the operating system secure credential store. It is rotated on every refresh." });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
});

api.post("/devices/refresh", async (req, res) => {
  const id = String(req.body?.deviceId ?? "").trim();
  const refreshToken = String(req.body?.refreshToken ?? "");
  if (!uuidPattern.test(id) || refreshToken.length < 32 || refreshToken.length > 128)
    return res.status(400).json({ error: "Provide a valid device ID and refresh token." });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT id,owner_id,device_refresh_hash,paired_at,revoked_at FROM devices WHERE id=$1 FOR UPDATE", [id]);
    const device = found.rows[0];
    if (!device || device.revoked_at || !device.paired_at || !device.device_refresh_hash || !(await bcrypt.compare(refreshToken, device.device_refresh_hash))) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "Invalid, expired, or revoked device refresh token." });
    }
    const nextRefreshToken = crypto.randomBytes(32).toString("base64url");
    const nextHash = await bcrypt.hash(nextRefreshToken, 12);
    await client.query("UPDATE devices SET device_refresh_hash=$2,last_seen_at=NOW() WHERE id=$1", [id, nextHash]);
    await client.query("COMMIT");
    return res.json({ deviceId: id, deviceToken: issueDeviceToken({ id, ownerId: device.owner_id }), refreshToken: nextRefreshToken, expiresInSeconds: 600 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
});

api.post("/devices/heartbeat", authenticateDevice, async (req, res) => {
  const updated = await db.query("UPDATE devices SET last_seen_at=NOW() WHERE id=$1 AND owner_id=$2 AND revoked_at IS NULL RETURNING id", [req.deviceAuth!.id, req.deviceAuth!.ownerId]);
  if (!updated.rowCount) return res.status(401).json({ error: "Device is revoked" });
  res.json({ ok: true, serverTime: new Date().toISOString() });
});

api.get("/devices", authenticate, async (req, res) => {
  const r = await db.query("SELECT id,label,platform,created_at,paired_at,last_seen_at,revoked_at,unattended_enabled FROM devices WHERE owner_id=$1 ORDER BY created_at DESC", [req.auth!.id]);
  res.json({ devices: r.rows });
});
api.post("/devices", authenticate, async (req, res) => {
  const label = String(req.body?.label ?? "").trim().slice(0, 80);
  const platform = String(req.body?.platform ?? "");
  if (!label || !["windows", "android", "web"].includes(platform)) return res.status(400).json({ error: "Provide a device label and platform: windows, android, or web." });
  const id = crypto.randomUUID();
  const deviceSecret = crypto.randomBytes(32).toString("base64url");
  const credentialHash = await bcrypt.hash(deviceSecret, 12);
  const r = await db.query("INSERT INTO devices(id,owner_id,label,platform,credential_hash) VALUES($1,$2,$3,$4,$5) RETURNING id,label,platform,created_at,paired_at,unattended_enabled", [id, req.auth!.id, label, platform, credentialHash]);
  await audit(req.auth!.id, "device.enrolled", { deviceId: id, platform });
  res.status(201).json({ device: r.rows[0], deviceSecret, warning: "Save this one-time pairing secret now. A native Windows/Android agent is not yet included in this build." });
});
api.post("/devices/:id/revoke", authenticate, async (req, res) => {
  const deviceId = String(req.params.id ?? "");
  if (!uuidPattern.test(deviceId)) return res.status(400).json({ error: "Invalid device ID." });
  const r = await db.query("UPDATE devices SET revoked_at=NOW(),unattended_enabled=FALSE,credential_hash=NULL,device_refresh_hash=NULL WHERE id=$1 AND owner_id=$2 AND revoked_at IS NULL RETURNING id", [deviceId, req.auth!.id]);
  if (!r.rowCount) return res.status(404).json({ error: "Device not found or already revoked." });
  await audit(req.auth!.id, "device.revoked", { deviceId });
  res.json({ ok: true });
});
api.post("/devices/:id/unattended/enable", authenticate, async (req, res) => {
  const deviceId = String(req.params.id ?? "");
  const password = String(req.body?.password ?? "");
  const code = String(req.body?.mfaCode ?? "");
  const u = await db.query("SELECT password_hash,mfa_enabled,mfa_secret FROM users WHERE id=$1", [req.auth!.id]);
  const user = u.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash)) || !user.mfa_enabled || !user.mfa_secret || !(await consumeTotpStep(req.auth!.id, decryptMfaSecret(user.mfa_secret), code)))
    return res.status(403).json({ error: "Unattended enrollment requires password re-authentication and a valid, unused authenticator code." });
  const r = await db.query("UPDATE devices SET unattended_enabled=TRUE WHERE id=$1 AND owner_id=$2 AND revoked_at IS NULL RETURNING id", [deviceId, req.auth!.id]);
  if (!r.rowCount) return res.status(404).json({ error: "Active device not found." });
  await audit(req.auth!.id, "device.unattended_enabled", { deviceId });
  res.json({ ok: true, message: "Unattended policy enrolled. The native agent must still enforce visible status and local revocation; this flag alone does not enable remote access." });
});
api.post("/devices/:id/unattended/disable", authenticate, async (req, res) => {
  const deviceId = String(req.params.id ?? "");
  const r = await db.query("UPDATE devices SET unattended_enabled=FALSE WHERE id=$1 AND owner_id=$2 AND revoked_at IS NULL RETURNING id", [deviceId, req.auth!.id]);
  if (!r.rowCount) return res.status(404).json({ error: "Active device not found." });
  await audit(req.auth!.id, "device.unattended_disabled", { deviceId });
  res.json({ ok: true });
});

api.get("/admin/overview", authenticate, requireAdmin, async (_req, res) => {
  const [users, devices, events] = await Promise.all([
    db.query("SELECT COUNT(*)::int AS count FROM users"),
    db.query("SELECT COUNT(*)::int AS count FROM devices WHERE revoked_at IS NULL"),
    db.query("SELECT COUNT(*)::int AS count FROM audit_events")
  ]);
  // Socket.IO sessions are not persisted yet; never present a misleading live-session count.
  res.json({ users: users.rows[0].count, devices: devices.rows[0].count, activeSessions: null, auditEvents: events.rows[0].count });
});
api.get("/admin/users", authenticate, requireAdmin, async (_req, res) => {
  const r = await db.query("SELECT id,email,role,mfa_enabled,created_at FROM users ORDER BY created_at DESC LIMIT 100");
  res.json({ users: r.rows });
});
api.get("/admin/devices", authenticate, requireAdmin, async (_req, res) => {
  const r = await db.query("SELECT d.id,d.label,d.platform,d.created_at,d.paired_at,d.last_seen_at,d.revoked_at,d.unattended_enabled,u.email AS owner_email FROM devices d JOIN users u ON u.id=d.owner_id ORDER BY d.created_at DESC LIMIT 100");
  res.json({ devices: r.rows });
});
api.post("/admin/devices/:id/revoke", authenticate, requireAdmin, async (req, res) => {
  const deviceId = String(req.params.id ?? "");
  if (!uuidPattern.test(deviceId)) return res.status(400).json({ error: "Invalid device ID." });
  const r = await db.query("UPDATE devices SET revoked_at=NOW(),unattended_enabled=FALSE,credential_hash=NULL,device_refresh_hash=NULL WHERE id=$1 AND revoked_at IS NULL RETURNING id,owner_id", [deviceId]);
  if (!r.rowCount) return res.status(404).json({ error: "Active device not found." });
  await audit(req.auth!.id, "admin.device_revoked", { deviceId, ownerId: r.rows[0].owner_id });
  res.json({ ok: true });
});
api.get("/admin/audit", authenticate, requireAdmin, async (_req, res) => {
  const r = await db.query("SELECT a.id,a.event_type,a.metadata_json,a.created_at,u.email AS actor_email FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 100");
  res.json({ events: r.rows });
});
