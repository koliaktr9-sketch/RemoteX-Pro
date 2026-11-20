"use client";
import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

const SIGNAL_URL = process.env.NEXT_PUBLIC_SIGNALING_URL ?? "http://localhost:4000";

export default function Home() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState("Connecting to signaling server…");
  const [sessionId, setSessionId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [role, setRole] = useState<"host" | "guest" | null>(null);
  const [incoming, setIncoming] = useState(false);
  const [approved, setApproved] = useState(false);
  const [message, setMessage] = useState("Create a support session or join with a code.");
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const s = io(SIGNAL_URL);
    setSocket(s);
    s.on("connect", () => setStatus("Connected"));
    s.on("connect_error", () => setStatus("Server unavailable — start apps/server."));
    s.on("session:incoming", ({ sessionId }) => { setSessionId(sessionId); setIncoming(true); setMessage("A user is requesting access. Approve only if you recognize them."); });
    s.on("session:approved", () => { setApproved(true); setMessage("Session approved. You can now establish a WebRTC connection."); });
    s.on("session:rejected", () => setMessage("The host declined this request."));
    s.on("session:ended", () => { cleanup(); setMessage("Session ended."); setApproved(false); setIncoming(false); });
    s.on("webrtc:offer", async ({ sessionId: id, data: offer }) => {
      setSessionId(id);
      const pc = ensurePeer(s, id);
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      s.emit("webrtc:answer", { sessionId: id, data: answer });
    });
    s.on("webrtc:answer", async ({ data: answer }) => { await pcRef.current?.setRemoteDescription(answer); });
    s.on("webrtc:ice", async ({ data: candidate }) => { try { await pcRef.current?.addIceCandidate(candidate); } catch {} });
    return () => { cleanup(); s.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cleanup() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
  }

  function ensurePeer(s: Socket, id: string) {
    if (pcRef.current) return pcRef.current;
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    pc.onicecandidate = e => { if (e.candidate) s.emit("webrtc:ice", { sessionId: id, data: e.candidate }); };
    pc.ontrack = e => { if (videoRef.current) videoRef.current.srcObject = e.streams[0]; };
    pcRef.current = pc;
    return pc;
  }

  function createSession() {
    if (!socket) return;
    socket.emit("session:create", (r: any) => {
      if (r?.ok) { setSessionId(r.sessionId); setRole("host"); setMessage("Share this code with the person you want to assist."); }
    });
  }

  function joinSession() {
    if (!socket) return;
    const id = joinCode.trim().toUpperCase();
    socket.emit("session:join", id, (r: any) => {
      if (r?.ok) { setSessionId(id); setRole("guest"); setMessage("Request sent. Waiting for host approval."); }
      else setMessage(r?.error ?? "Unable to join.");
    });
  }

  function approve() {
    if (!socket || !sessionId) return;
    socket.emit("session:approve", { sessionId });
    setIncoming(false);
  }

  async function shareScreen() {
    if (!socket || !sessionId || !approved) return;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      streamRef.current = stream;
      stream.getTracks()[0].addEventListener("ended", () => cleanup());
      const pc = ensurePeer(socket, sessionId);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("webrtc:offer", { sessionId, data: offer });
      setMessage("Screen sharing started. Stop sharing using the browser's sharing control.");
    } catch { setMessage("Screen sharing was cancelled or is not supported in this browser."); }
  }

  function endSession() {
    socket?.emit("session:leave", { sessionId });
    cleanup(); setApproved(false); setIncoming(false); setMessage("You ended the session.");
  }

  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brandMark">R</span><span>RemoteX <b>Pro</b></span></div>
      <div className="nav active">▦　Overview</div><div className="nav">▣　Devices <small>Planned</small></div><div className="nav">◷　Session history <small>Planned</small></div><div className="nav">⚙　Settings <small>Planned</small></div>
      <div className="sideFoot"><span className="dot"/> {status}</div>
    </aside>
    <section className="main">
      <header><div><p className="eyebrow">REMOTE SUPPORT WORKSPACE</p><h1>Good to see you.</h1><p className="muted">Start a secure, permission-based support session.</p></div><div className="avatar">RX</div></header>
      <section className="hero"><div><span className="pill">● PRIVATE SESSION</span><h2>Connect to another device<br/>with confidence.</h2><p>Every incoming request requires approval. Screen sharing uses the browser's native permission prompt.</p></div><div className="orb">R<span>↗</span></div></section>
      <div className="sectionHead"><div><h3>Connection center</h3><p className="muted">Choose how you want to connect.</p></div><span className="secure">⌑ Encrypted WebRTC transport</span></div>
      <div className="cards">
        <article className="card"><div className="iconBox purple">↗</div><h3>Share my screen</h3><p>Generate a one-time session code and wait for the other person to request access.</p><button onClick={createSession}>＋ Create session</button></article>
        <article className="card"><div className="iconBox blue">⌕</div><h3>Connect to a device</h3><p>Enter a session code provided by the person at the remote device.</p><input value={joinCode} onChange={e=>setJoinCode(e.target.value)} placeholder="Enter session code" maxLength={10}/><button className="secondary" onClick={joinSession} disabled={!joinCode.trim()}>Request connection</button></article>
      </div>
      <section className="sessionPanel">
        <div className="sectionHead"><div><h3>Active session</h3><p className="muted">{message}</p></div>{sessionId && <span className="code">{sessionId}</span>}</div>
        {incoming && <div className="notice"><div><b>Incoming access request</b><p>Only approve a person you trust.</p></div><button onClick={approve}>Approve request</button><button className="danger" onClick={()=>socket?.emit("session:reject",{sessionId})}>Decline</button></div>}
        {role === "host" && <div className="actions"><button onClick={shareScreen} disabled={!approved}>Share screen</button><span className="muted small">{approved ? "Approved — ready to share" : "Waiting for host approval step"}</span></div>}
        <video ref={videoRef} autoPlay playsInline className="remoteVideo"/>
        {sessionId && <button className="danger outline" onClick={endSession}>End session</button>}
      </section>
      <div className="accountLinks"><a href="/account">Account &amp; Device Security</a><a href="/admin">Admin Console</a></div><footer>RemoteX Pro · Development preview · Consent-first remote support</footer>
    </section>
  </main>;
}
