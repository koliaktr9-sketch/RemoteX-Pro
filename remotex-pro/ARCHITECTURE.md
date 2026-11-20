# RemoteX Pro Architecture

```text
+-----------------------+        HTTPS / WSS         +------------------------+
| Next.js web dashboard | <------------------------> | Node API + Socket.IO   |
| Account / Admin / UI  |        REST / signaling    | Auth / RBAC / Rooms    |
+-----------------------+                             +-----------+------------+
          |                                                        |
          | WebRTC media (DTLS-SRTP; P2P when possible)             |
          +--------------------------------------------------------+
                                   |
                          TURN relay (production)
                                   |
                     +-------------+-------------+
                     |                           |
              Windows native agent        Android native agent
              (not yet implemented)       (not yet implemented)
```

## Implemented trust boundaries
- User registration creates a standard user; admin is provisioned separately.
- Web access tokens and device tokens use separate JWT audiences and token types.
- MFA uses TOTP with encrypted secret storage and atomic replay protection.
- Device enrollment creates a one-time secret stored as a bcrypt hash. Pairing consumes it under a row lock and issues a short-lived device token.
- Device heartbeat and revocation check the current database state.
- Attended session signaling is relayed only after host approval; only session participants may end a session.
- The Socket.IO service itself is still unauthenticated and in-memory; this is a development-only boundary, not a production guarantee.

## Main services
- **Identity**: email/password, short-lived JWT, TOTP MFA.
- **Admin**: current-role authorization, user/device/audit views, admin device revocation.
- **Device registry**: one-time pairing, scoped access/refresh tokens, heartbeat, revocation and unattended policy record.
- **Signaling**: room membership and offer/answer/ICE relay after explicit host approval (still unauthenticated).
- **Media**: WebRTC with DTLS-SRTP; production TURN fallback required.
- **Audit**: account, MFA, pairing and device lifecycle events.

## Database
PostgreSQL migrations:
- `001_initial.sql`: users, devices, sessions and audit events.
- `002_device_pairing_and_mfa_replay.sql`: paired timestamp, device refresh-token hash and last accepted TOTP step.

## Not implemented
- Authenticated/persistent signaling and live session telemetry.
- Native Windows screen/input agent and Android MediaProjection/foreground-service agent.
- Device-bound private keys/attestation and secure refresh flow.
- Unattended enforcement, visible local indicator and offline revocation.
- TURN credential service, secure file transfer, signed updater and production monitoring.
