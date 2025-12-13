import React from "react";

type AttemptSummary = {
  attemptId: number;
  userId: number;
  userEmail: string;
  status: string;
  score: number;
  startedAt: string;
  submittedAt?: string | null;
  lastSnapshot?: string | null;
  eventCounts: Record<string, number>;
};

export default function AdminAttempts({ token, quizId, onOpenSession }: { token: string; quizId: number; onOpenSession: (userId: string) => void }) {
  const [rows, setRows] = React.useState<AttemptSummary[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState("");

  const load = async () => {
    setLoading(true); setErr("");
    try {
      const res = await fetch(`/admin/quiz/${quizId}/attempts`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setRows(data.attempts || []);
    } catch (e: any) { setErr(e?.message || "Failed to load attempts"); }
    finally { setLoading(false); }
  };

  React.useEffect(() => { if (quizId) load(); }, [quizId]);

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 className="heading">Attempts</h3>
        <button className="btn secondary" onClick={load} disabled={loading}>{loading? 'Loading...' : 'Refresh'}</button>
      </div>
      {err && <div className="muted" style={{ color: 'var(--danger)' }}>{err}</div>}
      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px 6px' }}>User</th>
              <th style={{ textAlign: 'left', padding: '8px 6px' }}>Status</th>
              <th style={{ textAlign: 'left', padding: '8px 6px' }}>Score</th>
              <th style={{ textAlign: 'left', padding: '8px 6px' }}>Started</th>
              <th style={{ textAlign: 'left', padding: '8px 6px' }}>Submitted</th>
              <th style={{ textAlign: 'left', padding: '8px 6px' }}>Flags</th>
              <th style={{ textAlign: 'left', padding: '8px 6px' }}>Last Snapshot</th>
              <th style={{ textAlign: 'left', padding: '8px 6px' }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.attemptId} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <td style={{ padding: '8px 6px' }}>{r.userEmail}</td>
                <td style={{ padding: '8px 6px' }}>{r.status}</td>
                <td style={{ padding: '8px 6px' }}>{r.score}</td>
                <td style={{ padding: '8px 6px' }}>{new Date(r.startedAt).toLocaleString()}</td>
                <td style={{ padding: '8px 6px' }}>{r.submittedAt ? new Date(r.submittedAt).toLocaleString() : '-'}</td>
                <td style={{ padding: '8px 6px' }}>
                  {Object.entries(r.eventCounts || {}).map(([k,v]) => (
                    <span key={k} className="chip" style={{ marginRight: 6 }}>{k}:{v}</span>
                  ))}
                </td>
                <td style={{ padding: '8px 6px' }}>{r.lastSnapshot ? <img src={r.lastSnapshot} style={{ width: 80, borderRadius: 6 }} /> : '-'}</td>
                <td style={{ padding: '8px 6px' }}>
                  <button className="btn" onClick={() => onOpenSession(String(r.userId))}>Open Session</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="muted" style={{ padding: 8 }}>No attempts yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

