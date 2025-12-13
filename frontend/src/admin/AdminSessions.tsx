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
  const [snapshots, setSnapshots] = React.useState<{ ts: string | number; url: string; type: string }[]>([]);
  const [timeline, setTimeline] = React.useState<{ start: number; end: number }>({ start: Date.now(), end: Date.now() });
  const [cursor, setCursor] = React.useState<number>(Date.now());
  const [followLive, setFollowLive] = React.useState(true);
  const [hoverPreview, setHoverPreview] = React.useState<{ url: string; x: number } | null>(null);
  const [recordingUrl, setRecordingUrl] = React.useState<string | null>(null);
  const [quizIdInput, setQuizIdInput] = React.useState<string>("");
  const socketRef = React.useRef<Socket | null>(null);
  const pcRef = React.useRef<RTCPeerConnection | null>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    const s = io(undefined, { auth: { token }, transports: ["websocket"], path: "/socket.io" });
    socketRef.current = s;
    const onEvent = (ev: any) => {
      setEvents((prev) => [ev, ...prev]);
      try {
        const payload = ev?.payload || ev;
        const tsNum = new Date(ev.createdAt || payload?.timestamp || new Date().toISOString()).getTime();
        if (payload?.evidence?.url && (payload?.type === 'screen_snapshot' || payload?.type?.includes('face'))) {
          setSnapshots((prev) => [{ ts: tsNum, url: payload.evidence.url, type: payload.type }, ...prev].slice(0, 200));
        }
        setTimeline((t) => ({ start: Math.min(t.start, tsNum), end: Math.max(t.end, Date.now()) }));
      } catch {}
    };
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
              <div className="row" style={{ marginBottom: 8, justifyContent: 'space-between' }}>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn" onClick={requestView}>Request Screen</button>
                  <button className="btn danger" onClick={forceStop}>Force Stop</button>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <input className="input" style={{ width: 100 }} placeholder="Quiz ID" value={quizIdInput} onChange={(e) => setQuizIdInput(e.target.value)} />
                  <a className="btn secondary" href={quizIdInput ? `/admin/quiz/${encodeURIComponent(quizIdInput)}/attempts` : undefined} onClick={(e) => e.preventDefault()}>View Attempts API</a>
                </div>
              </div>
              <video ref={videoRef} autoPlay playsInline controls style={{ width: "100%", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)" }} />

              {/* Recordings player (if a manifest or a latest chunk is available) */}
              {recordingUrl && (
                <div className="card" style={{ marginTop: 12 }}>
                  <h4>Recording Preview</h4>
                  <video src={recordingUrl} controls style={{ width: '100%', borderRadius: 8 }} />
                </div>
              )}

              <Timeline
                start={timeline.start}
                end={timeline.end}
                cursor={cursor}
                followLive={followLive}
                events={events}
                snapshots={snapshots as any}
                onCursorChange={(t) => { setCursor(t); setFollowLive(t >= Date.now() - 1500); }}
                onFollowLive={() => { setFollowLive(true); setCursor(Date.now()); setTimeline((tl) => ({ ...tl, end: Date.now() })); }}
                onHoverPreview={setHoverPreview}
              />
              {hoverPreview && (
                <div style={{ position: 'relative', height: 0 }}>
                  <div style={{ position: 'absolute', left: hoverPreview.x, transform: 'translateX(-50%)', bottom: 8, background: 'rgba(0,0,0,0.75)', border: '1px solid rgba(255,255,255,0.1)', padding: 6, borderRadius: 8 }}>
                    <img src={hoverPreview.url} style={{ width: 160, height: 'auto', display: 'block', borderRadius: 6 }} />
                  </div>
                </div>
              )}
              <h4 style={{ marginTop: 12 }}>Evidence Snapshots</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                {snapshots.map((s, i) => (
                  <div key={i} className="card" style={{ padding: 6 }}>
                    <div className="muted" style={{ fontSize: 10 }}>{new Date(s.ts).toLocaleTimeString()} · {s.type}</div>
                    <img src={s.url} style={{ width: '100%', borderRadius: 6 }} />
                  </div>
                ))}
                {snapshots.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No snapshots yet.</div>}
              </div>
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

function Timeline(props: {
  start: number; end: number; cursor: number; followLive: boolean;
  events: any[];
  snapshots: { ts: number; url: string; type: string }[];
  onCursorChange: (t: number) => void;
  onFollowLive: () => void;
  onHoverPreview: (p: { url: string; x: number } | null) => void;
}) {
  const { start, end, cursor, followLive, events, snapshots, onCursorChange, onFollowLive, onHoverPreview } = props;
  const span = Math.max(1, end - start);
  const toPct = (t: number) => ((t - start) / span) * 100;
  const onRange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    onCursorChange(start + (val / 1000) * span);
  };
  React.useEffect(() => {
    if (!followLive) return;
    const id = window.setInterval(() => onCursorChange(Date.now()), 1000);
    return () => clearInterval(id);
  }, [followLive, start, end]);
  const colors: Record<string,string> = {
    fullscreen_exit: '#ff6b6b',
    tab_switch: '#f7b955',
    multiple_faces_detected: '#b26bff',
    no_face_detected: '#ffa8a8',
    screen_snapshot: '#6c8cff',
    admin_forced_stop: '#ff3b3b',
  };
  const getColor = (t?: string) => colors[t || ''] || '#9aa3b2';

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="muted" style={{ fontSize: 12 }}>{new Date(start).toLocaleTimeString()} – {new Date(end).toLocaleTimeString()}</div>
        <div className="row" style={{ gap: 8 }}>
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={followLive} onChange={(e) => e.target.checked ? onFollowLive() : onCursorChange(cursor)} /> Follow live
          </label>
          <button className="btn secondary" onClick={onFollowLive}>Jump to live</button>
        </div>
      </div>
      <div style={{ position: 'relative', height: 32, marginTop: 8, background: '#121733', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
        {events.slice(0, 500).map((e, i) => {
          const ts = new Date(e.createdAt || e?.payload?.timestamp || Date.now()).getTime();
          const left = `${toPct(ts)}%`;
          const c = getColor(e?.payload?.type || e?.type);
          return <div key={i} title={e?.payload?.type || e?.type} style={{ position: 'absolute', left, top: 0, bottom: 0, width: 2, background: c, opacity: 0.85 }} />;
        })}
        {snapshots.slice(0, 500).map((s, i) => {
          const left = `${toPct(s.ts)}%`;
          return (
            <div key={i}
              onMouseEnter={(ev) => onHoverPreview({ url: s.url, x: (ev.currentTarget.getBoundingClientRect().left + ev.currentTarget.getBoundingClientRect().right)/2 })}
              onMouseLeave={() => onHoverPreview(null)}
              style={{ position: 'absolute', left, top: 0, bottom: 0, width: 2, background: '#6c8cff' }}
            />
          );
        })}
        <div style={{ position: 'absolute', left: `${toPct(cursor)}%`, top: 0, bottom: 0, width: 2, background: '#fff' }} />
      </div>
      <input type="range" min={0} max={1000} value={Math.max(0, Math.min(1000, Math.round(((cursor - start) / span) * 1000)))} onChange={onRange} style={{ width: '100%', marginTop: 6 }} />
    </div>
  );
}
