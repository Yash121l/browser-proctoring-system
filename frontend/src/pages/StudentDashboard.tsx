import React from "react";

export default function StudentDashboard({ token, onStart }: { token: string; onStart: (quiz: any, attempt: any) => void }) {
  const [quizzes, setQuizzes] = React.useState<any[]>([]);

  React.useEffect(() => {
    (async () => {
      const res = await fetch("/api/quizzes", { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setQuizzes(data.quizzes || []);
    })();
  }, [token]);

  const start = async (q: any) => {
    const res = await fetch(`/api/quizzes/${q.id}/start`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    // Cache the ws token for SDK to use
    sessionStorage.setItem("candidate_ws_token", data.wsToken);
    onStart(q, data.attempt);
  };

  return (
    <div>
      <h3>Available Quizzes</h3>
      <ul>
        {quizzes.map((q) => (
          <li key={q.id}>
            <div style={{ display: "flex", justifyContent: "space-between", maxWidth: 600 }}>
              <div>
                <strong>{q.title}</strong>
                <div style={{ fontSize: 12, color: "#666" }}>{q.description}</div>
              </div>
              <button onClick={() => start(q)}>Start</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
