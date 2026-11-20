# Phase 3 — Windows native agent

## Delivered
- Electron Windows agent UI with explicit pairing and visible state.
- Main-process-only device credentials; context-isolated preload bridge.
- DPAPI-backed Electron `safeStorage` persistence, atomic writes, and fail-closed behavior.
- One-time device pairing, rotating refresh token, 10-minute device access token use, and 60-second heartbeat.
- Revocation handling clears local credentials and reports a visible revoked state.
- Host-initiated local display capture requires click + confirmation + platform picker; Stop ends all capture tracks.
- HTTPS required for non-local API endpoints.

## Verification
Run `cd apps/windows && npm test`. Tests cover encrypted-store behavior, no-plaintext fallback, pairing, heartbeat auth header, refresh rotation, server revocation, and HTTPS enforcement. Syntax checks use `node --check` on the agent scripts.

## Limitations
This is an Electron desktop agent, not yet a native Windows service. The capture demo is local only; it is not connected to a remote WebRTC peer. Remote input, authenticated signaling, TURN, signed packaging, and native OS policy enforcement are not implemented. Unattended access remains disabled and is not offered by the agent.
