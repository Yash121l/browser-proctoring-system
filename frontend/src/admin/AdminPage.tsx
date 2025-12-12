import React from "react";
import { io, Socket } from "socket.io-client";

type SessionInfo = { testId: string; userId: string; socketId: string; connectedAt: number };

/**
 * AdminPage
 * - Admin login to obtain proctor JWT
 * - List active sessions
 * - Join a session room, live receive events
 * - Request live screen share via WebRTC (simple 1:1)
 * - Force stop session
 */
export default function AdminPage() {
  const [token, setToken] = React.useState<string | null>(null);
  const [socket, setSocket] = React.useState<Socket | null>(null);
  const [sessions, setSessions] = React.useState<SessionInfo[]>([]);
  const [selected, setSelected] = React.useState<SessionInfo | null>(null);
  const [events, setEvents] = React.useState<any[]>([]);
  const [pc, setPc] = React.useState<RTCPeerConnection | null>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);

  const adminLogin = async (adminId: string, secret: string) => {
    const res = await fetch("/auth/adminLogin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminId, secret }),
    });
    if (!res.ok) throw new Error("admin login failed");
    const { token } = await res.json();
    setToken(token);
    const s = io(undefined, { auth: { token }, transports: ["websocket"], path: "/socket.io" });
    setSocket(s);
  };

  const refreshSessions = async () => {
    if (!token) return;
    const res = await fetch(`/admin/sessions`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    setSessions(data.sessions || []);
  };

  const joinSession = async (s: SessionInfo) => {
    if (!socket || !token) return;
    setSelected(s);
    socket.emit("admin_join_session", { testId: s.testId, userId: s.userId });

    // Load recent events
    const res = await fetch(`/admin/events?testId=${encodeURIComponent(s.testId)}&userId=${encodeURIComponent(s.userId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    setEvents(data.events || []);
  };

  const requestView = () => {
    if (!socket || !selected) return;
    socket.emit("admin_view_request", { testId: selected.testId, userId: selected.userId });
  };

  const setupWebRTC = () => {
    const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    peer.ontrack = (e) => {
      const [stream] = e.streams;
      if (videoRef.current) videoRef.current.srcObject = stream;
    };
    peer.onicecandidate = (e) => {
      if (e.candidate && selected && socket) {
        socket.emit("webrtc-ice-admin", { testId: selected.testId, userId: selected.userId, candidate: e.candidate });
      }
    };
    setPc(peer);
  };

  React.useEffect(() => {
    if (!socket) return;
    setupWebRTC();
    const onEvent = (ev: any) => setEvents((prev) => [ev, ...prev]);
    socket.on("event_broadcast", onEvent);
    socket.on("webrtc-offer", async (offer: any) => {
      if (!pc) return;
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (selected) socket.emit("webrtc-answer", { testId: selected.testId, userId: selected.userId, answer });
    });
    socket.on("webrtc-ice-candidate", async (candidate: any) => {
      try { await pc?.addIceCandidate(candidate); } catch {}
    });
    return () => {
      socket.off("event_broadcast", onEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, pc]);

  const forceStop = () => {
    if (!socket || !selected) return;
    socket.emit("admin_stop", { testId: selected.testId, userId: selected.userId });
  };

  return (
    <div style={{ padding: 24 }}>
      <h2>Admin Console</h2>
      {!token ? (
        <div>
          <input id="adminId" placeholder="Admin ID" defaultValue="admin1" />
          <input id="secret" placeholder="Shared Secret" defaultValue="changeme" />
          <button onClick={() => adminLogin((document.getElementById("adminId") as HTMLInputElement).value, (document.getElementById("secret") as HTMLInputElement).value)}>Login</button>
        </div>
      ) : (
        <div>
          <button onClick={refreshSessions}>Refresh Sessions</button>
          <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
            <div style={{ flex: 1 }}>
              <h3>Active Sessions</h3>
              <ul>
                {sessions.map((s) => (
                  <li key={s.socketId}>
                    <button onClick={() => joinSession(s)}>{s.testId} / {s.userId}</button>
                  </li>
                ))}
              </ul>
            </div>
            <div style={{ flex: 2 }}>
              <h3>Session Details</h3>
              {selected ? (
                <div>
                  <div style={{ marginBottom: 8 }}>
                    <button onClick={requestView}>Request Screen</button>
                    <button onClick={forceStop} style={{ marginLeft: 8 }}>Force Stop</button>
                  </div>
                  <video ref={videoRef} autoPlay playsInline controls style={{ width: "100%", border: "1px solid #ccc" }} />
                  <h4>Recent Events</h4>
                  <div style={{ maxHeight: 200, overflow: "auto", border: "1px solid #eee", padding: 8 }}>
                    {events.map((e, i) => (
                      <pre key={i} style={{ margin: 0 }}>{JSON.stringify(e, null, 2)}</pre>
                    ))}
                  </div>
                </div>
              ) : (
                <p>Select a session to view</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

