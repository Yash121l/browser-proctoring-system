import React from "react";

type Quiz = {
  id: number;
  title: string;
  description?: string | null;
  proctorEnabled?: boolean;
  proctorConfig?: any;
  questions?: any[];
};

export default function AdminQuizzes({ token, onEdit }: { token: string; onEdit: (quiz: Quiz) => void }) {
  const [quizzes, setQuizzes] = React.useState<Quiz[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string>("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/quizzes", { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setQuizzes(data.quizzes || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load quizzes");
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { load(); }, [token]);

  const remove = async (id: number) => {
    if (!confirm("Delete this quiz? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/quizzes/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      setQuizzes((prev) => prev.filter((q) => q.id !== id));
    } catch (e: any) {
      alert(e?.message || "Delete failed");
    }
  };

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 className="heading">Quizzes</h3>
        <button className="btn secondary" onClick={load} disabled={loading}>{loading ? "Loading..." : "Refresh"}</button>
      </div>
      {error && <p className="muted" style={{ color: "var(--danger)" }}>{error}</p>}
      <ul className="list" style={{ marginTop: 8 }}>
        {quizzes.map((q) => (
          <li key={q.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div><strong>{q.title}</strong></div>
                {q.description && <div className="muted" style={{ fontSize: 12 }}>{q.description}</div>}
                <div className="muted" style={{ fontSize: 12 }}>Questions: {q.questions?.length ?? 0} · Proctoring: {q.proctorEnabled ? "On" : "Off"}</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn" onClick={() => onEdit(q)}>Edit</button>
                <button className="btn danger" onClick={() => remove(q.id)}>Delete</button>
              </div>
            </div>
          </li>
        ))}
        {quizzes.length === 0 && !loading && <li className="muted">No quizzes yet.</li>}
      </ul>
    </div>
  );
}

