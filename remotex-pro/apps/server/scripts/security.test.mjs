import test from "node:test";
import assert from "node:assert/strict";

process.env.MFA_ENCRYPTION_KEY = "0123456789abcdef".repeat(4);
const security = await import("../dist/mfa.js");

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // ASCII 12345678901234567890

test("RFC 6238 SHA-1 six-digit TOTP vector at t=59 seconds", () => {
  assert.equal(security.totpCodeAt(RFC_SECRET, 1), "287082");
  assert.equal(security.matchingTotpStep(RFC_SECRET, "287082", 59), 1);
});

test("TOTP rejects malformed and incorrect codes", () => {
  assert.equal(security.matchingTotpStep(RFC_SECRET, "12ab56", 59), null);
  assert.equal(security.matchingTotpStep(RFC_SECRET, "000000", 59), null);
});

test("MFA secret encryption round-trips and detects tampering", () => {
  const encrypted = security.encryptMfaSecret("MY-PRIVATE-TOTP-SECRET");
  assert.equal(security.decryptMfaSecret(encrypted), "MY-PRIVATE-TOTP-SECRET");
  const parts = encrypted.split(".");
  parts[2] = (parts[2][0] === "0" ? "1" : "0") + parts[2].slice(1);
  assert.throws(() => security.decryptMfaSecret(parts.join(".")));
});

test("generated TOTP secrets are Base32 and long enough", () => {
  const secret = security.newTotpSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
});
