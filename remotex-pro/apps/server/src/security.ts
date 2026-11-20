import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { db } from "./db.js";
import { matchingTotpStep } from "./mfa.js";
export { newTotpSecret, totpUri, matchingTotpStep, encryptMfaSecret, decryptMfaSecret, totpCodeAt } from "./mfa.js";

export type Role = "user" | "admin";
export type AuthUser = { id: string; email: string; role: Role; mfaEnabled: boolean };
export type DeviceAuth = { id: string; ownerId: string };
declare global {
  namespace Express {
    interface Request { auth?: AuthUser; deviceAuth?: DeviceAuth }
  }
}

const issuer = "remotex-pro";
const secret = () => {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error("JWT_SECRET must be at least 32 characters");
  return value;
};

export function issueToken(user: AuthUser) {
  return jwt.sign(
    { typ: "user", email: user.email, role: user.role, mfaEnabled: user.mfaEnabled },
    secret(),
    { subject: user.id, expiresIn: "15m", issuer, audience: "remotex-web" }
  );
}

export function issueDeviceToken(device: DeviceAuth) {
  return jwt.sign(
    { typ: "device", ownerId: device.ownerId },
    secret(),
    { subject: device.id, expiresIn: "10m", issuer, audience: "remotex-device" }
  );
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    const p = jwt.verify(token, secret(), { issuer, audience: "remotex-web" }) as jwt.JwtPayload;
    if (p.typ !== "user" || typeof p.sub !== "string" || !["user", "admin"].includes(String(p.role))) throw new Error("Invalid token");
    req.auth = { id: p.sub, email: String(p.email ?? ""), role: p.role as Role, mfaEnabled: Boolean(p.mfaEnabled) };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired access token" });
  }
}

export async function authenticateDevice(req: Request, res: Response, next: NextFunction) {
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Device authentication required" });
  try {
    const p = jwt.verify(token, secret(), { issuer, audience: "remotex-device" }) as jwt.JwtPayload;
    if (p.typ !== "device" || typeof p.sub !== "string" || typeof p.ownerId !== "string") throw new Error("Invalid device token");
    const active = await db.query("SELECT id,owner_id FROM devices WHERE id=$1 AND owner_id=$2 AND revoked_at IS NULL AND paired_at IS NOT NULL", [p.sub, p.ownerId]);
    if (!active.rowCount) return res.status(401).json({ error: "Device is revoked or no longer enrolled" });
    req.deviceAuth = { id: p.sub, ownerId: p.ownerId };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid, expired, or revoked device token" });
  }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: "Authentication required" });
  try {
    // Re-check the database role so demotion takes effect immediately, not after JWT expiry.
    const r = await db.query("SELECT role FROM users WHERE id=$1", [req.auth.id]);
    if (r.rows[0]?.role !== "admin") return res.status(403).json({ error: "Administrator access required" });
    req.auth.role = "admin";
    next();
  } catch (error) { next(error); }
}

export function audit(actorId: string, event: string, details: Record<string, unknown> = {}) {
  return db.query(
    "INSERT INTO audit_events(actor_id,event_type,metadata_json) VALUES($1,$2,$3)",
    [actorId, event, JSON.stringify(details)]
  );
}

// Atomic compare-and-set prevents the same TOTP step from being replayed concurrently.
export async function consumeTotpStep(userId: string, secretValue: string, token: string) {
  const step = matchingTotpStep(secretValue, token);
  if (step === null) return false;
  const r = await db.query(
    "UPDATE users SET last_totp_step=$2 WHERE id=$1 AND last_totp_step < $2 RETURNING id",
    [userId, step]
  );
  return Boolean(r.rowCount);
}
