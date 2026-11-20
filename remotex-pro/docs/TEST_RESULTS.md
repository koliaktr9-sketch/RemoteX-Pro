# Phase 2.1 verification record

## Executed in this workspace
- Node.js built-in unit tests for the production MFA helper source: **4 passed, 0 failed**.
  - RFC 6238 SHA-1 TOTP known vector.
  - Malformed/incorrect TOTP rejection.
  - AES-256-GCM MFA secret round-trip and tamper detection.
  - Random Base32 secret shape/length.
- TypeScript/TSX files were transpiled with the globally available TypeScript compiler for syntax diagnostics.
- `package.json` files were parsed as JSON.
- Node smoke-test script and Electron main process passed `node --check`.

## Not executed / pending environment
- Dependency-backed server TypeScript build and Next.js production build: npm dependency installation did not complete in this workspace.
- PostgreSQL migrations and API integration smoke test: no PostgreSQL service or configured application database was available.
- End-to-end pairing/heartbeat/revocation and admin action tests require the database-backed API to be running.
- WebRTC across NAT/TURN, native Windows/Android agent, unattended enforcement, signed updates and penetration testing are not implemented.

## Re-run after setup
```bash
cd apps/server
npm install
psql "$DATABASE_URL" -f migrations/001_initial.sql
psql "$DATABASE_URL" -f migrations/002_device_pairing_and_mfa_replay.sql
npm run test:unit
npm run dev
# in another terminal, with API and PostgreSQL running:
npm run test:smoke
```
