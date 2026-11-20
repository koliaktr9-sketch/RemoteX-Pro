import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { Server } from "socket.io";
import { api } from "./routes.js";

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", methods: ["GET", "POST"], allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json({ limit: "32kb" }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));
app.use("/api/devices/pair", rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false }));
app.use("/api/devices/refresh", rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false }));
app.use("/api", api);
app.get("/health", (_req, res) => res.json({ ok: true, service: "remotex-api", version: "0.3.0" }));
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled API error", err);
  res.status(500).json({ error: "Internal server error" });
});

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", methods: ["GET", "POST"] } });

// Development-only signaling: no authenticated socket handshake or persistent session store yet.
// Keep private. Attended sessions still require explicit host approval before WebRTC relay.
type Session = { id: string; hostSocketId: string; guestSocketId?: string; approved: boolean; createdAt: number };
const sessions = new Map<string, Session>();
io.on("connection", socket => {
  socket.on("session:create", (ack?: (r: unknown) => void) => {
    const id = cryptoRandomCode();
    sessions.set(id, { id, hostSocketId: socket.id, approved: false, createdAt: Date.now() });
    socket.join(id);
    ack?.({ ok: true, sessionId: id });
  });
  socket.on("session:join", (raw: unknown, ack?: (r: unknown) => void) => {
    const id = typeof raw === "string" ? raw.trim().toUpperCase() : "";
    const s = sessions.get(id);
    if (!/^[0-9A-F]{16}$/.test(id) || !s || s.guestSocketId || s.hostSocketId === socket.id || s.approved) {
      ack?.({ ok: false, error: "Session not found or unavailable." }); return;
    }
    s.guestSocketId = socket.id;
    socket.join(id);
    io.to(s.hostSocketId).emit("session:incoming", { sessionId: id });
    ack?.({ ok: true, sessionId: id, awaitingApproval: true });
  });
  socket.on("session:approve", (raw: unknown) => {
    const sessionId = typeof raw === "object" && raw !== null ? String((raw as any).sessionId ?? "") : "";
    const s = sessions.get(sessionId);
    if (!s || s.hostSocketId !== socket.id || !s.guestSocketId) return;
    s.approved = true;
    io.to(sessionId).emit("session:approved", { sessionId });
  });
  socket.on("session:reject", (raw: unknown) => {
    const sessionId = typeof raw === "object" && raw !== null ? String((raw as any).sessionId ?? "") : "";
    const s = sessions.get(sessionId);
    if (!s || s.hostSocketId !== socket.id) return;
    io.to(sessionId).emit("session:rejected", { sessionId });
    sessions.delete(sessionId);
  });
  for (const event of ["webrtc:offer", "webrtc:answer", "webrtc:ice"]) {
    socket.on(event, (raw: unknown) => {
      if (typeof raw !== "object" || raw === null) return;
      const payload = raw as { sessionId?: unknown; data?: unknown };
      const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
      const s = sessions.get(sessionId);
      if (!s || !s.approved || ![s.hostSocketId, s.guestSocketId].includes(socket.id)) return;
      socket.to(sessionId).emit(event, { sessionId, data: payload.data });
    });
  }
  socket.on("session:leave", (raw: unknown) => {
    const sessionId = typeof raw === "object" && raw !== null ? String((raw as any).sessionId ?? "") : "";
    const s = sessions.get(sessionId);
    // A random connected socket must not be able to terminate another pair's session.
    if (!s || ![s.hostSocketId, s.guestSocketId].includes(socket.id)) return;
    io.to(sessionId).emit("session:ended", { sessionId });
    sessions.delete(sessionId);
  });
  socket.on("disconnect", () => {
    for (const [id, s] of sessions) {
      if (s.hostSocketId === socket.id || s.guestSocketId === socket.id) {
        io.to(id).emit("session:ended", { sessionId: id });
        sessions.delete(id);
      }
    }
  });
});
function cryptoRandomCode() { return randomBytes(8).toString("hex").toUpperCase(); }
const port = Number(process.env.PORT ?? 4000);
httpServer.listen(port, () => console.log(`RemoteX API/signaling listening on :${port}`));
