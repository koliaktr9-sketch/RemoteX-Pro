# RemoteX Pro API (Phase 2.1)

1. Create a PostgreSQL database and user.
2. Copy `.env.example` to `.env`.
3. Set a strong `JWT_SECRET` (32+ characters) and a 64-character hex `MFA_ENCRYPTION_KEY`:
   ```bash
   openssl rand -hex 32
   openssl rand -hex 32
   ```
4. Apply both migrations in order:
   ```bash
   psql "$DATABASE_URL" -f migrations/001_initial.sql
   psql "$DATABASE_URL" -f migrations/002_device_pairing_and_mfa_replay.sql
   ```
5. Install dependencies and provision an admin:
   ```bash
   npm install
   npm run seed:admin
   npm run dev
   ```

Registration requires at least 12 characters and no more than 72 UTF-8 bytes (bcrypt input limit) and always creates a regular user. Admin role is assigned only by the seed script / controlled database operation. User access JWTs expire after 15 minutes. Device access tokens expire after 10 minutes and are checked against the active device row on each request. Device refresh tokens are rotated on use and must be stored in the native OS secure credential store. TOTP secrets are AES-256-GCM encrypted at rest; accepted TOTP time steps are atomically consumed to prevent replay.

## API routes
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `POST /api/auth/mfa/setup`, `POST /api/auth/mfa/confirm`
- `GET/POST /api/devices`, `POST /api/devices/pair`, `POST /api/devices/refresh`, `POST /api/devices/heartbeat`
- `POST /api/devices/:id/revoke`
- `POST /api/devices/:id/unattended/enable`, `POST /api/devices/:id/unattended/disable`
- `GET /api/admin/overview`, `/users`, `/devices`, `/audit`
- `POST /api/admin/devices/:id/revoke`

## Tests
```bash
npm run test:unit
npm run test:smoke # requires running API + PostgreSQL
```

## Scope warning
The one-time pairing and heartbeat APIs are implemented, but native Windows/Android agents are not. The unattended setting is only a policy record, not working unattended remote access. Socket.IO signaling is still unauthenticated and in-memory; keep this service on localhost/private development networks. This build is not production-ready.
