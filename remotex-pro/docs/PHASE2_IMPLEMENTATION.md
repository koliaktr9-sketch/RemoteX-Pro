# RemoteX Pro — Phase 2.1 implementation notes

This phase hardens the identity, admin and device-registration scaffold. It remains a development MVP, not a production remote-desktop service.

## Implemented in this build
- PostgreSQL schema for users, devices, sessions and audit events; migration `002_device_pairing_and_mfa_replay.sql` adds pairing and MFA replay state.
- Email/password registration with bcrypt cost 12; passwords are limited to 72 UTF-8 bytes to avoid bcrypt truncation; unknown-account login uses a dummy bcrypt hash; registration always creates a regular user.
- 15-minute user access JWTs with separate audience/type claims for web users and devices.
- Authentication and device-pairing rate limits, Helmet headers and a single-origin CORS allow-list.
- RFC 6238 TOTP MFA; secrets encrypted at rest using AES-256-GCM.
- Atomic TOTP-step consumption prevents the same authenticator code/time-step from being replayed for MFA confirmation, login or unattended enrollment.
- MFA setup requires password re-authentication. Admin role is re-checked against PostgreSQL on every admin API request.
- User-owned device registration creates a random pairing secret, stores only a bcrypt hash and shows the secret once.
- `POST /api/devices/pair` consumes that secret once under a database row lock, then issues a 10-minute device-scoped JWT plus a rotating refresh token. Refresh tokens are bcrypt-hashed and rotated on every use; a second use fails.
- `POST /api/devices/heartbeat` accepts only a paired, non-revoked device token and updates `last_seen_at`. `POST /api/devices/refresh` rotates the device refresh token. Revocation clears both refresh credentials and invalidates access tokens immediately.
- Users can list and revoke their devices. Admins can view users/devices/audit events and revoke devices from the dashboard.
- Account UI supports registration/login, MFA setup, device enrollment and revocation. Admin UI has overview, user, device and audit views.
- Attended signaling requires host approval before WebRTC messages are relayed. Session leave now checks that the sender is a participant; session codes are 64-bit random values.

## API routes
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `POST /api/auth/mfa/setup`, `POST /api/auth/mfa/confirm`
- `GET/POST /api/devices`, `POST /api/devices/pair`, `POST /api/devices/refresh`, `POST /api/devices/heartbeat`
- `POST /api/devices/:id/revoke`
- `POST /api/devices/:id/unattended/enable` (password + unused TOTP code), `POST /api/devices/:id/unattended/disable`
- `GET /api/admin/overview`, `/users`, `/devices`, `/audit`; `POST /api/admin/devices/:id/revoke`

## Explicitly incomplete / not production-ready
- The pairing API is implemented, but Windows and Android native agents are not included. No native app currently sends the pairing proof or heartbeat.
- The unattended flag is only an account policy record. It does not enable remote control. A signed native agent must enforce the policy, show a persistent local indicator, require device-bound keys, and support local/offline revocation.
- Socket.IO signaling still has no authenticated handshake, no account/device ownership binding and no persistent session store. It is development-only; do not expose it publicly.
- Admin live-session count is deliberately shown as unavailable rather than reporting the stale/always-zero PostgreSQL session table.
- Browser WebRTC uses public STUN only; production requires TURN with short-lived credentials and TLS/WSS.
- Web bearer tokens are held in sessionStorage. Production should use Secure, HttpOnly, SameSite cookies, CSRF protection and refresh-token rotation.
- No email verification, account recovery, robust lockout/abuse controls, device key attestation, secure file transfer, signed updater or formal penetration test.
- No Windows native capture/input agent, Android MediaProjection implementation or remote keyboard/mouse control is included.

## Consent model
Attended sessions require explicit host approval; browser screen capture uses the native screen-picker prompt. Unattended access remains disabled by default and is only a policy flag in this build. It must not be treated as operational until a signed native agent enforces explicit enrollment, MFA-backed authorization, visible status and revocation.
