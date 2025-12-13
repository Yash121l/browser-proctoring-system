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
  const [playlist, setPlaylist] = React.useState<{ url: string; ts: number; seq: number; source?: 'screen'|'camera' }[]>([]);
  const [quizIdInput, setQuizIdInput] = React.useState<string>("");
  const [seekTs, setSeekTs] = React.useState<number | null>(null);
  const [typeFilter, setTypeFilter] = React.useState<Record<string, boolean>>({});
  const socketRef = React.useRef<Socket | null>(null);
  const pcRef = React.useRef<RTCPeerConnection | null>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  
  // Seamless player using Media Source Extensions
  function ChunkPlayer({ playlist, seekTs }: { playlist: { url: string; ts: number; seq: number }[]; seekTs?: number }) {
    const vref = React.useRef<HTMLVideoElement>(null);
    const [idx, setIdx] = React.useState(0);
    const [appending, setAppending] = React.useState(false);

    React.useEffect(() => { setIdx(0); }, [JSON.stringify(playlist.map((p) => p.url))]);

    React.useEffect(() => {
      const video = vref.current;
      if (!video || !playlist.length || !('MediaSource' in window)) return;
      const ms = new MediaSource();
      video.src = URL.createObjectURL(ms);
      let source: SourceBuffer | null = null;
      let canceled = false;

      const startFrom = (() => {
        if (!seekTs) return 0;
        const j = playlist.findIndex((c) => Number(c.ts) >= Number(seekTs));
        return j >= 0 ? j : 0;
      })();

      const appendChunk = async (i: number) => {
        if (canceled || i >= playlist.length) return;
        setIdx(i);
        setAppending(true);
        const res = await fetch(playlist[i].url);
        const buf = await res.arrayBuffer();
        await new Promise<void>((resolve, reject) => {
          if (!source) return reject(new Error('no source buffer'));
          const onUpdate = () => { source?.removeEventListener('updateend', onUpdate); resolve(); };
          source.addEventListener('updateend', onUpdate);
          try { source.appendBuffer(buf); } catch (e) { source.removeEventListener('updateend', onUpdate); reject(e); }
        });
        setAppending(false);
        appendChunk(i + 1);
      };

      ms.addEventListener('sourceopen', () => {
        try {
          source = ms.addSourceBuffer('video/webm; codecs="vp8,vorbis"');
          appendChunk(startFrom);
        } catch {
          // fallback to normal playback of first chunk
          video.src = playlist[startFrom].url;
        }
      });

      return () => { canceled = true; try { ms.endOfStream(); } catch {} };
    }, [playlist, seekTs]);

    if (!playlist.length) return <div className="muted">No chunks</div>;
    return (
      <div>
        <video ref={vref} controls style={{ width: '100%', borderRadius: 8 }} />
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
          <div className="muted" style={{ fontSize: 12 }}>Chunk {idx+1}/{playlist.length}</div>
          {appending && <div className="muted" style={{ fontSize: 12 }}>Loading…</div>}
        </div>
      </div>
    );
  }

  // Dual player: side-by-side screen + camera using two MSE players with filtered playlists
  function DualPlayer({ playlist, seekTs }: { playlist: { url: string; ts: number; seq: number; source?: 'screen'|'camera' }[]; seekTs?: number }) {
    const screen = playlist.filter((c) => c.source !== 'camera');
    const camera = playlist.filter((c) => c.source === 'camera');
    return (
      <div className="row" style={{ gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Screen</div>
          <ChunkPlayer playlist={screen as any} seekTs={seekTs} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Camera</div>
          <ChunkPlayer playlist={camera as any} seekTs={seekTs} />
        </div>
      </div>
    );
  }

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
    const list: SessionInfo[] = data.sessions || [];
    setSessions(list);
    // Auto-join target from sessionStorage if available
    try {
      const t = sessionStorage.getItem('admin_target_session');
      if (t) {
        const tgt = JSON.parse(t) as { testId: string; userId: string; loadRecording?: boolean };
        const match = list.find((s) => s.testId === String(tgt.testId) && s.userId === String(tgt.userId));
        if (match) {
          await joinSession(match);
          if (tgt.loadRecording) await loadRecording();
          sessionStorage.removeItem('admin_target_session');
        } else {
          // Fallback: open an offline analysis view for past sessions
          await openOfflineSession(String(tgt.testId), String(tgt.userId));
          if (tgt.loadRecording) await loadRecording();
          sessionStorage.removeItem('admin_target_session');
        }
      }
    } catch {}
  };

  // Open analysis for a session that is no longer active
  const openOfflineSession = async (testId: string, userId: string) => {
    const virtual: SessionInfo = { testId, userId, socketId: 'offline', connectedAt: Date.now() };
    setSelected(virtual);
    const res = await fetch(`/admin/events?testId=${encodeURIComponent(testId)}&userId=${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    setEvents(data.events || []);
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
    setPlaylist([]);
  };

  // Auto-refresh on mount to honor admin_target_session
  React.useEffect(() => { refreshSessions(); }, []);

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

  const loadRecording = async () => {
    if (!selected) return;
    const res = await fetch(`/admin/recordings/manifest?testId=${encodeURIComponent(selected.testId)}&userId=${encodeURIComponent(selected.userId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { alert('No manifest yet'); return; }
    const data = await res.json();
    const chunks = (data.chunks || []).sort((a: any, b: any) => Number(a.seq) - Number(b.seq));
    setPlaylist(chunks);
    if (chunks[0]?.url) setRecordingUrl(chunks[0].url);
  };

  // simplified redesign not applied here to avoid conflicts; retain existing layout
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 className="heading">Live Sessions</h3>
        <button className="btn secondary" onClick={refreshSessions}>Refresh</button>
      </div>
      <div className="row" style={{ gap: 20, marginTop: 16 }}>
        <div className="card" style={{ flex: 1 }}>
          <h4>Active</h4>
          <ul className="list">
            {sessions.map((s) => (
              <li key={s.socketId}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
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
              <div className="row" style={{ marginBottom: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div>
                  <div><strong>Test {selected.testId}</strong> <span className="muted">/ User {selected.userId}</span></div>
                  <div className="row" style={{ gap: 8, marginTop: 4 }}>
                    {selected.socketId === 'offline' && <span className="chip" style={{ background: '#3a2a18', color: '#ffebc1' }}>Offline Analysis</span>}
                    {events.length > 0 && <span className="chip">Last event: {new Date(Math.max(...events.map((e:any)=> new Date(e.createdAt||e?.payload?.timestamp||Date.now()).getTime()))).toLocaleTimeString()}</span>}
                  </div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn" onClick={requestView} disabled={selected.socketId === 'offline'}>Request Screen</button>
                  <button className="btn danger" onClick={forceStop} disabled={selected.socketId === 'offline'}>Force Stop</button>
                </div>
              </div>
              <video ref={videoRef} autoPlay playsInline controls style={{ width: '100%', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)' }} />

              <div className="card" style={{ marginTop: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h4>Recording</h4>
                  <button className="btn secondary" onClick={loadRecording}>Load Recording</button>
                </div>
                {playlist.length === 0 ? (
                  <div className="muted" style={{ fontSize: 12 }}>No recording manifest yet.</div>
                ) : (
                  <DualPlayer playlist={playlist as any} />
                )}
              </div>

              <Timeline
                start={timeline.start}
                end={timeline.end}
                cursor={cursor}
                followLive={followLive}
                events={events}
                snapshots={snapshots as any}
                onCursorChange={(t) => { setCursor(t); setSeekTs(t); setFollowLive(t >= Date.now() - 1500); }}
                onFollowLive={() => { setFollowLive(true); const now = Date.now(); setSeekTs(now); setCursor(now); setTimeline((tl) => ({ ...tl, end: now })); }}
                onHoverPreview={setHoverPreview}
              />
              {hoverPreview && (
                <div style={{ position: 'relative', height: 0 }}>
                  <div style={{ position: 'absolute', left: hoverPreview.x, transform: 'translateX(-50%)', bottom: 8, background: 'rgba(0,0,0,0.75)', border: '1px solid rgba(255,255,255,0.1)', padding: 6, borderRadius: 8 }}>
                    <img src={hoverPreview.url} style={{ width: 160, height: 'auto', display: 'block', borderRadius: 6 }} />
                  </div>
                </div>
              )}
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
