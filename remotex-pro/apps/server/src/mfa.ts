import crypto from "node:crypto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Encode(buf: Buffer) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(s: string) {
  let bits = 0, value = 0; const out: number[] = [];
  for (const c of s.replace(/=+$/, "").toUpperCase()) {
    const n = alphabet.indexOf(c);
    if (n < 0) throw new Error("Invalid TOTP secret");
    value = (value << 5) | n; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function mfaKey() {
  const raw = process.env.MFA_ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error("MFA_ENCRYPTION_KEY must be a 32-byte hex key");
  return Buffer.from(raw, "hex");
}
export function encryptMfaSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", mfaKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}.${cipher.getAuthTag().toString("hex")}.${encrypted.toString("hex")}`;
}
export function decryptMfaSecret(value: string) {
  const parts = value.split(".");
  if (parts.length !== 3 || !parts.every((p) => /^[0-9a-f]+$/i.test(p))) throw new Error("Invalid encrypted MFA secret");
  const [ivHex, tagHex, dataHex] = parts;
  if (ivHex.length !== 24 || tagHex.length !== 32) throw new Error("Invalid encrypted MFA secret");
  const decipher = crypto.createDecipheriv("aes-256-gcm", mfaKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

export function newTotpSecret() { return base32Encode(crypto.randomBytes(20)); }
export function totpUri(email: string, secretValue: string) {
  const issuerName = "RemoteX Pro";
  return `otpauth://totp/${encodeURIComponent(issuerName)}:${encodeURIComponent(email)}?secret=${secretValue}&issuer=${encodeURIComponent(issuerName)}&algorithm=SHA1&digits=6&period=30`;
}
export function totpCodeAt(secretValue: string, step: number) {
  const key = base32Decode(secretValue);
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", key).update(msg).digest();
  const offset = h[h.length - 1] & 0x0f;
  const code = ((h[offset] & 0x7f) << 24) | ((h[offset + 1] & 0xff) << 16) | ((h[offset + 2] & 0xff) << 8) | (h[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}
export function matchingTotpStep(secretValue: string, token: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!/^\d{6}$/.test(token)) return null;
  const current = Math.floor(nowSeconds / 30);
  for (const step of [current, current - 1, current + 1]) {
    const expected = totpCodeAt(secretValue, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token))) return step;
  }
  return null;
}
