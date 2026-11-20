# RemoteX Pro — consent-first remote support development scaffold

A multi-platform starter repository for a remote-support product:
- Responsive web workspace, account security and admin dashboard (Next.js)
- Node.js API, PostgreSQL identity/device registry and Socket.IO signaling
- Windows Electron shell
- Android Kotlin/Compose client starter

## Scope and safety
This is a **development MVP scaffold, not a production AnyDesk replacement**. The account, admin and device-registration APIs are partially implemented and tested at the unit level. The native Windows/Android agents, secure signaling and remote-control data plane are not complete.

Consent rules:
- Attended sessions require host approval before WebRTC negotiation messages are relayed.
- Screen capture is initiated through the browser's visible native screen-picker permission.
- Unattended access is disabled by default. The account setting is only a policy record; no native agent enforces it yet. Do not use it as working unattended remote access.
- No hidden capture, OS-permission bypass or silent remote-control functionality is included.

## Requirements
- Node.js 20+
- npm 10+
- PostgreSQL 14+
- Android Studio for the Android UI starter
- Windows 10/11 for the Electron shell

## Run the API
```bash
cd apps/server
cp .env.example .env
# Configure DATABASE_URL, JWT_SECRET, MFA_ENCRYPTION_KEY, ADMIN_EMAIL and ADMIN_PASSWORD.
psql "$DATABASE_URL" -f migrations/001_initial.sql
psql "$DATABASE_URL" -f migrations/002_device_pairing_and_mfa_replay.sql
npm install
npm run seed:admin
npm run dev
```

## Run the web dashboard
In another terminal:
```bash
cd apps/web
cp .env.example .env.local
npm install
npm run dev
```
Open `http://localhost:3000`. Use `/account` for registration/login, MFA and device management; use `/admin` after signing in with the seeded admin account.

## Verification
```bash
cd apps/server
npm run test:unit
# With API + PostgreSQL running:
npm run test:smoke
```
See `docs/TEST_RESULTS.md` for checks actually completed in the build workspace and checks still pending.

## Run the Windows shell
```bash
cd apps/windows
npm install
npm start
```
Package/sign the application only after configuring trusted code signing and a signed update process.

## Android
Open `apps/android` in Android Studio. This is a UI/client foundation only; native screen capture, unattended access and remote input are intentionally not enabled.

## Important limitations
- Socket.IO signaling is still unauthenticated and in-memory. Keep it private; do not expose it publicly.
- Device pairing proof and heartbeat APIs exist, but no native agent currently uses them.
- The unattended-access flag does not enable remote control. Signed native enforcement, visible indicators and local/offline revocation are still required.
- Web tokens remain in sessionStorage in this prototype. Production requires HttpOnly cookies, CSRF protection, refresh-token rotation, TLS/WSS, TURN, operational monitoring and independent security review.
- No production readiness or full security certification is claimed.

See `docs/PHASE2_IMPLEMENTATION.md`, `docs/SECURITY_CHECKLIST.md` and `ARCHITECTURE.md`.

## Phase 3 — Windows agent

The Windows Electron agent is in `apps/windows`. See `apps/windows/README.md` and `docs/PHASE3_WINDOWS_AGENT.md` for pairing, DPAPI credential storage, refresh rotation, heartbeat, host-approved local capture, tests, and limitations. Unattended access remains disabled in the agent; no background capture or remote control is provided.
