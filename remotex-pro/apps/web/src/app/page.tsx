"use client";
import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import Link from "next/link";

const SIGNAL_URL = process.env.NEXT_PUBLIC_SIGNALING_URL ?? "http://localhost:4000";

export default function Home() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState("Connecting to server…");
  const [isConnected, setIsConnected] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [role, setRole] = useState<"host" | "guest" | null>(null);
  const [incoming, setIncoming] = useState(false);
  const [approved, setApproved] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("Create a support session or enter a 16-character code to connect.");
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const s = io(SIGNAL_URL, { reconnectionAttempts: 5, timeout: 5000 });
    setSocket(s);

    s.on("connect", () => {
      setStatus("Signaling Online");
      setIsConnected(true);
    });

    s.on("connect_error", () => {
      setStatus("Signaling Offline");
      setIsConnected(false);
    });

    s.on("session:incoming", ({ sessionId }) => {
      setSessionId(sessionId);
      setIncoming(true);
      setMessage("A user requested remote access. Approve only if you recognize the request.");
    });

    s.on("session:approved", () => {
      setApproved(true);
      setMessage("Session approved! Establishing WebRTC connection…");
    });

    s.on("session:rejected", () => {
      setMessage("The host declined your connection request.");
      setApproved(false);
      setIncoming(false);
    });

    s.on("session:ended", () => {
      cleanup();
      setMessage("Session has been terminated.");
      setApproved(false);
      setIncoming(false);
      setSessionId("");
      setRole(null);
      setIsSharing(false);
    });

    s.on("webrtc:offer", async ({ sessionId: id, data: offer }) => {
      setSessionId(id);
      const pc = ensurePeer(s, id);
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      s.emit("webrtc:answer", { sessionId: id, data: answer });
    });

    s.on("webrtc:answer", async ({ data: answer }) => {
      await pcRef.current?.setRemoteDescription(answer);
      setMessage("Live peer-to-peer screen stream active.");
    });

    s.on("webrtc:ice", async ({ data: candidate }) => {
      try {
        await pcRef.current?.addIceCandidate(candidate);
      } catch {}
    });

    return () => {
      cleanup();
      s.disconnect();
    };
  }, []);

  function cleanup() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    setIsSharing(false);
  }

  function ensurePeer(s: Socket, id: string) {
    if (pcRef.current) return pcRef.current;
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    });
    pc.onicecandidate = (e) => {
      if (e.candidate) s.emit("webrtc:ice", { sessionId: id, data: e.candidate });
    };
    pc.ontrack = (e) => {
      if (videoRef.current) {
        videoRef.current.srcObject = e.streams[0];
        setMessage("Receiving live remote screen stream.");
      }
    };
    pcRef.current = pc;
    return pc;
  }

  function createSession() {
    if (!socket) return;
    socket.emit("session:create", (r: any) => {
      if (r?.ok) {
        setSessionId(r.sessionId);
        setRole("host");
        setMessage("Session code generated. Share it with the guest to start.");
      }
    });
  }

  function joinSession() {
    if (!socket) return;
    const id = joinCode.trim().toUpperCase().replace(/[^0-9A-F]/g, "");
    if (id.length !== 16) {
      setMessage("Please enter a valid 16-character hexadecimal code.");
      return;
    }
    socket.emit("session:join", id, (r: any) => {
      if (r?.ok) {
        setSessionId(id);
        setRole("guest");
        setMessage("Connection request sent! Awaiting host authorization.");
      } else {
        setMessage(r?.error ?? "Unable to join session.");
      }
    });
  }

  function approve() {
    if (!socket || !sessionId) return;
    socket.emit("session:approve", { sessionId });
    setIncoming(false);
    setApproved(true);
  }

  async function shareScreen() {
    if (!socket || !sessionId || !approved) return;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" } as any,
        audio: false
      });
      streamRef.current = stream;
      setIsSharing(true);
      stream.getTracks()[0].addEventListener("ended", () => {
        cleanup();
        setMessage("Screen sharing stopped by user.");
      });

      const pc = ensurePeer(socket, sessionId);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("webrtc:offer", { sessionId, data: offer });
      setMessage("Screen sharing active via encrypted WebRTC channel.");
    } catch {
      setMessage("Screen capture was cancelled or not allowed by browser.");
    }
  }

  function endSession() {
    socket?.emit("session:leave", { sessionId });
    cleanup();
    setApproved(false);
    setIncoming(false);
    setSessionId("");
    setRole(null);
    setMessage("You ended the session.");
  }

  function copyCode() {
    if (!sessionId) return;
    navigator.clipboard.writeText(sessionId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function toggleFullScreen() {
    if (!videoRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      videoRef.current.requestFullscreen().catch(() => {});
    }
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brandMark">R</span>
          <span>RemoteX <b>Pro</b></span>
        </Link>

        <div className="navSection">
          <p className="navLabel">Navigation</p>
          <div className="nav active">▦　Overview</div>
          <Link href="/account" className="nav">▣　Account &amp; Security</Link>
          <Link href="/admin" className="nav">⚙　Admin Console</Link>
        </div>

        <div className="navSection">
          <p className="navLabel">Features</p>
          <div className="nav">◷　Session Logs <small>Audited</small></div>
          <div className="nav">🔒　Consent Rules <small>Attended</small></div>
        </div>

        <div className="sideFoot">
          <span className={`dot ${isConnected ? "" : "offline"}`} />
          <span>{status}</span>
        </div>
      </aside>

      <section className="main">
        <header>
          <div>
            <p className="eyebrow">ENTERPRISE REMOTE SUPPORT WORKSPACE</p>
            <h1>Good to see you.</h1>
            <p className="muted">Zero-trust, attended remote desktop with browser-native WebRTC.</p>
          </div>
          <div className="avatar">RX</div>
        </header>

        <section className="hero">
          <div>
            <span className="pill">● SECURE &amp; ATTENDED</span>
            <h2>Connect to any device<br />with full user consent.</h2>
            <p>Every session requires explicit host verification before any video stream is negotiated. No hidden background access.</p>
          </div>
          <div className="orb">RX</div>
        </section>

        <div className="sectionHead">
          <div>
            <h3>Connection Center</h3>
            <p className="muted">Start a new host session or join a remote host.</p>
          </div>
          <span className="secure">⌑ Peer-to-Peer Encrypted WebRTC</span>
        </div>

        <div className="cards">
          <article className="card">
            <div className="iconBox purple">↗</div>
            <h3>Share My Screen (Host)</h3>
            <p>Generate a secure 16-character session code and share it with the person assisting you.</p>
            <button onClick={createSession} disabled={!isConnected}>
              ＋ Generate Session Code
            </button>
          </article>

          <article className="card">
            <div className="iconBox blue">⌕</div>
            <h3>Connect to Remote Device (Guest)</h3>
            <p>Enter the 16-character session code provided by the remote user to request access.</p>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="e.g. 57854F764257DE46"
              maxLength={16}
            />
            <button
              className="secondary"
              onClick={joinSession}
              disabled={!isConnected || joinCode.trim().length !== 16}
            >
              Request Remote Connection
            </button>
          </article>
        </div>

        <section className="sessionPanel">
          <div className="sectionHead">
            <div>
              <h3>Session Controller</h3>
              <p className="muted">{message}</p>
            </div>
            {sessionId && (
              <div className="codeBox">
                <span className="code">{sessionId}</span>
                <button className="secondary sm" onClick={copyCode}>
                  {copied ? "Copied! ✓" : "Copy Code"}
                </button>
              </div>
            )}
          </div>

          {incoming && (
            <div className="notice">
              <div>
                <b>Incoming Remote Access Request</b>
                <p>A guest is requesting to connect to your screen. Approve only if you requested support.</p>
              </div>
              <div className="noticeActions">
                <button onClick={approve}>Approve Access</button>
                <button className="danger" onClick={() => socket?.emit("session:reject", { sessionId })}>
                  Decline
                </button>
              </div>
            </div>
          )}

          {role === "host" && (
            <div className="actions">
              <button onClick={shareScreen} disabled={!approved || isSharing}>
                {isSharing ? "Screen Sharing Active" : "Start Screen Share"}
              </button>
              <span className="muted small">
                {approved ? "✓ Host Approved — Click to start display capture" : "Waiting for guest connection & approval step"}
              </span>
            </div>
          )}

          <div className="videoWrapper">
            <video ref={videoRef} autoPlay playsInline className="remoteVideo" />
            {!isSharing && !videoRef.current?.srcObject && (
              <div className="videoPlaceholder">
                <p>🖥️ Remote video display will appear here once connected and shared.</p>
              </div>
            )}
          </div>

          {sessionId && (
            <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
              <button className="secondary" onClick={toggleFullScreen}>
                ⛶ Fullscreen
              </button>
              <button className="danger outline" onClick={endSession}>
                ✕ Terminate Session
              </button>
            </div>
          )}
        </section>

        <div className="accountLinks">
          <Link href="/account">Account Security &amp; Device Pairing</Link>
          <Link href="/admin">Administrator Governance Console</Link>
        </div>

        <footer>
          RemoteX Pro · Development Scaffold · Consent-First WebRTC Architecture
        </footer>
      </section>
    </main>
  );
}
