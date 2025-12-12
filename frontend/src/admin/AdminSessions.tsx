import React from "react";
import { io, Socket } from "socket.io-client";

type SessionInfo = { testId: string; userId: string; socketId: string; connectedAt: number };

/**
 * AdminSessions
 * Displays active candidate sessions, lets admin join a session room, see live
 * events and request live screen share, and force stop the session.
 * Expects a valid admin (proctor) JWT via props.
 */
export default function AdminSessions({ token }: { token: string }) {
  const [sessions, setSessions] = React.useState<SessionInfo[]>([]);
  const [selected, setSelected] = React.useState<SessionInfo | null>(null);
  const [events, setEvents] = React.useState<any[]>([]);
  const socketRef = React.useRef<Socket | null>(null);
  const pcRef = React.useRef<RTCPeerConnection | null>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    const s = io(undefined, { auth: { token }, transports: ["websocket"], path: "/socket.io" });
    socketRef.current = s;
    const onEvent = (ev: any) => setEvents((prev) => [ev, ...prev]);
    s.on("event_broadcast", onEvent);
    s.on("webrtc-offer", async (offer: any) => {
      try {
        if (pcRef.current) {
          pcRef.current.ontrack = null;
          pcRef.current.onicecandidate = null as any;
          pcRef.current.getReceivers().forEach((r) => r.track?.stop());
          pcRef.current.close();
        }
        const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
        pcRef.current = peer;
        peer.ontrack = (e) => {
          const [stream] = e.streams;
          if (videoRef.current) videoRef.current.srcObject = stream;
        };
        peer.onicecandidate = (e) => {
          if (e.candidate && selected) {
            s.emit("webrtc-ice-admin", { testId: selected.testId, userId: selected.userId, candidate: e.candidate });
          }
        };
        await peer.setRemoteDescription(offer);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        if (selected) s.emit("webrtc-answer", { testId: selected.testId, userId: selected.userId, answer });
      } catch {}
    });
    s.on("webrtc-ice-candidate", async (candidate: any) => {
      try { await pcRef.current?.addIceCandidate(candidate); } catch {}
    });
    return () => {
      s.off("event_broadcast", onEvent);
      s.off("webrtc-offer");
      s.off("webrtc-ice-candidate");
      s.close();
      if (pcRef.current) {
        pcRef.current.getReceivers().forEach((r) => r.track?.stop());
        pcRef.current.close();
        pcRef.current = null;
      }
    };
  }, [token, selected]);

  const refreshSessions = async () => {
    const res = await fetch(`/admin/sessions`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    setSessions(data.sessions || []);
  };

  const joinSession = async (s: SessionInfo) => {
    const socket = socketRef.current;
    if (!socket) return;
    setSelected(s);
    socket.emit("admin_join_session", { testId: s.testId, userId: s.userId });
    const res = await fetch(`/admin/events?testId=${encodeURIComponent(s.testId)}&userId=${encodeURIComponent(s.userId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    setEvents(data.events || []);
  };

  const requestView = () => {
    const socket = socketRef.current;
    if (!socket || !selected) return;
    socket.emit("admin_view_request", { testId: selected.testId, userId: selected.userId });
  };

  const forceStop = () => {
    const socket = socketRef.current;
    if (!socket || !selected) return;
    socket.emit("admin_stop", { testId: selected.testId, userId: selected.userId });
  };

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 className="heading">Live Sessions</h3>
        <button className="btn secondary" onClick={refreshSessions}>Refresh</button>
      </div>
      <div className="row" style={{ gap: 20, marginTop: 16 }}>
        <div className="card" style={{ flex: 1 }}>
          <h4>Active</h4>
          <ul className="list">
            {sessions.map((s) => (
              <li key={s.socketId}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <div><strong>{s.testId}</strong> <span className="muted">/ {s.userId}</span></div>
                    <div className="muted" style={{ fontSize: 12 }}>Connected: {new Date(s.connectedAt).toLocaleTimeString()}</div>
                  </div>
                  <button className="btn" onClick={() => joinSession(s)}>Open</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="card" style={{ flex: 2 }}>
          <h4>Selected Session</h4>
          {!selected ? (
            <p className="muted">Select a session to view.</p>
          ) : (
            <div>
              <div className="row" style={{ marginBottom: 8 }}>
                <button className="btn" onClick={requestView}>Request Screen</button>
                <button className="btn danger" onClick={forceStop}>Force Stop</button>
              </div>
              <video ref={videoRef} autoPlay playsInline controls style={{ width: "100%", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)" }} />
              <h4>Recent Events</h4>
              <div style={{ maxHeight: 240, overflow: "auto", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: 8 }}>
                {events.map((e, i) => (
                  <pre key={i} style={{ margin: 0, fontSize: 12 }}>{JSON.stringify(e, null, 2)}</pre>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

