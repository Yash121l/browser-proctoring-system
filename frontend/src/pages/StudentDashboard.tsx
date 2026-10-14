import React from "react";
import PreflightChecks from "./PreflightChecks";
import { track } from "../analytics";

export default function StudentDashboard({ token, onStart }: { token: string; onStart: (quiz: any, attempt: any) => void }) {
  const [quizzes, setQuizzes] = React.useState<any[]>([]);
  const [selected, setSelected] = React.useState<any | null>(null);
  const [showChecks, setShowChecks] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      const res = await fetch("/api/quizzes", { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setQuizzes(data.quizzes || []);
    })();
  }, [token]);

  const start = async (q: any) => {
    setSelected(q);
    if (q.proctorEnabled) {
      setShowChecks(true);
    } else {
      const res = await fetch(`/api/quizzes/${q.id}/start`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      sessionStorage.setItem("candidate_ws_token", data.wsToken);
      track("quiz_attempt_started", { quiz_id: String(q.id), proctored: false, question_count: q.questions?.length ?? 0 });
      onStart(q, data.attempt);
    }
  };

  const onChecksReady = async () => {
    if (!selected) return;
    const res = await fetch(`/api/quizzes/${selected.id}/start`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    sessionStorage.setItem("candidate_ws_token", data.wsToken);
    track("quiz_attempt_started", { quiz_id: String(selected.id), proctored: true, question_count: selected.questions?.length ?? 0 });
    setShowChecks(false);
    onStart(selected, data.attempt);
  };

  return (
    <div>
      {showChecks && selected ? (
        <PreflightChecks
          onReady={onChecksReady}
          require={{
            camera: true,
            screen: Boolean(selected?.proctorConfig?.checks?.screenRecording ?? true),
            fullscreen: Boolean(selected?.proctorConfig?.checks?.forceFullScreen ?? true),
          }}
        />
      ) : (
        <div className="card">
          <h3 className="heading">Available Quizzes</h3>
          <ul className="list">
            {quizzes.map((q) => (
              <li key={q.id}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <strong>{q.title}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>{q.description}</div>
                    <div className="row" style={{ gap: 8 }}>
                      {q.proctorEnabled && <span className="chip">Proctoring</span>}
                      {q?.proctorConfig?.checks?.screenRecording && <span className="chip">Screen</span>}
                      {q?.proctorConfig?.checks?.faceDetection && <span className="chip">Face</span>}
                    </div>
                  </div>
                  <button className="btn" onClick={() => start(q)}>Start</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
