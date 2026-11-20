# RemoteX Pro Windows Agent (development build)

## Implemented
- Electron desktop agent with an always-visible main window and explicit connection state.
- One-time pairing through `POST /api/devices/pair` using the device ID and one-time secret created in the account dashboard.
- Device refresh-token rotation through `POST /api/devices/refresh` and periodic `POST /api/devices/heartbeat` calls.
- Refresh credentials are encrypted with Electron `safeStorage` (Windows DPAPI) and written atomically under Electron's per-user `userData` directory. The agent refuses to store credentials if OS encryption is unavailable; it has no plaintext fallback.
- Device access token remains in main-process memory. The renderer cannot read tokens or access Node APIs.
- A server-side 401/revocation response stops the agent and erases local credentials. Network errors show an offline state and retain the encrypted refresh token for retry.
- Remote API URLs must use HTTPS except localhost development endpoints.
- Attended local screen capture requires a host button click, a second confirmation, and the Chromium/Electron display picker. Capture is stopped by the host using the Stop button.

## Not implemented / placeholders
- No signaling client, WebRTC peer connection, screen stream relay, remote keyboard/mouse, clipboard, file transfer, or remote command execution.
- The screen-capture button only demonstrates local, host-approved capture; no remote viewer receives the stream.
- No Windows service, background startup, hidden mode, or unattended capture. Unattended access is intentionally unavailable in this agent.
- No code-signing certificate or installer/update pipeline is included.

## Run
1. Start the API and PostgreSQL using the root project instructions and apply migrations `001` and `002`.
2. In the account dashboard, enroll a Windows device and copy the one-time device ID and pairing secret.
3. In `apps/windows`, copy `.env.example` to `.env` and set `REMOTEX_API_URL` (HTTPS outside localhost).
4. Run `npm install`, then `npm test`, then `npm start`.
5. Paste the device ID and one-time secret into the agent. The secret is consumed once and cleared from the input after pairing.

## Security notes
The agent uses the existing server API contract. Refresh-token rotation is single-use server-side. If the server rotates a token but the local encrypted write fails, the agent cannot safely continue with the old token; re-pairing may be required. The agent does not claim that heartbeat is proof of a live human session. Keep the API private until authenticated signaling, production TLS, monitoring, and end-to-end tests are complete.
