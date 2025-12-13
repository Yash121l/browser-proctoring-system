import React from "react";
import { ProctorSDK } from "./sdk/ProctorSDK";
import type { ProctorConfig } from "./core/types";
import AdminSessions from "./admin/AdminSessions";
import AdminQuizzes from "./admin/AdminQuizzes";
import QuizBuilder from "./admin/QuizBuilder";
import AdminAttempts from "./admin/AdminAttempts";
import Login from "./pages/Login";
import StudentDashboard from "./pages/StudentDashboard";
import TakeQuiz from "./pages/TakeQuiz";

/**
 * Demo App
 * Logs in to get a JWT, configures ProctorSDK, and starts monitoring.
 */
export default function App() {
  const [sdk, setSdk] = React.useState<ProctorSDK | null>(null);
  const [token, setToken] = React.useState<string | null>(null);
  const [role, setRole] = React.useState<"student" | "admin" | null>(null);
  const [status, setStatus] = React.useState<string>("idle");
  const [quiz, setQuiz] = React.useState<any | null>(null);
  const [attempt, setAttempt] = React.useState<any | null>(null);
  const [adminTab, setAdminTab] = React.useState<"sessions" | "quizzes" | "builder" | "attempts">("sessions");
  const [builderQuiz, setBuilderQuiz] = React.useState<any | null>(null);
  const [attemptsQuizId, setAttemptsQuizId] = React.useState<number | null>(null);

  React.useEffect(() => {
    // Expose sample callbacks
    (window as any).onViolationHandler = (evt: any) => {
      console.log("Violation callback:", evt);
    };
    (window as any).onForceSubmitHandler = () => {
      console.log("Force submit triggered");
    };
  }, []);

  if (!token) return <Login onLogin={(t, r) => { setToken(t); setRole(r); }} />;

  if (quiz && attempt) {
    return <TakeQuiz token={token} quiz={quiz} attempt={attempt} onSubmitted={() => { setQuiz(null); setAttempt(null); }} />;
  }

  // Admin console with tabs
  if (role === "admin") {
    return (
      <div className="container">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h2 className="heading">Admin Console</h2>
          <div className="row" style={{ gap: 8 }}>
            <button className={`btn ${adminTab === 'sessions' ? '' : 'secondary'}`} onClick={() => setAdminTab('sessions')}>Sessions</button>
            <button className={`btn ${adminTab === 'quizzes' ? '' : 'secondary'}`} onClick={() => { setAdminTab('quizzes'); setBuilderQuiz(null); }}>Quizzes</button>
            <button className={`btn ${adminTab === 'builder' ? '' : 'secondary'}`} onClick={() => { setAdminTab('builder'); setBuilderQuiz(null); }}>Quiz Builder</button>
            <button className={`btn ${adminTab === 'attempts' ? '' : 'secondary'}`} onClick={() => { setAdminTab('attempts'); }}>Attempts</button>
          </div>
        </div>
        {adminTab === "sessions" && <AdminSessions token={token} />}
        {adminTab === "quizzes" && (
          <AdminQuizzes token={token} onEdit={(q) => { setBuilderQuiz(q); setAdminTab('builder'); }} />
        )}
        {adminTab === "builder" && (
          <QuizBuilder token={token} initialQuiz={builderQuiz || undefined} onSaved={() => setAdminTab('quizzes')} />
        )}
        {adminTab === "attempts" && (
          <div className="card">
            <div className="row" style={{ gap: 8 }}>
              <input
                className="input"
                style={{ width: 160 }}
                placeholder="Quiz ID"
                value={attemptsQuizId ?? ''}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : null;
                  setAttemptsQuizId(val);
                  try {
                    const url = new URL(window.location.href);
                    if (val != null) url.searchParams.set('quizId', String(val)); else url.searchParams.delete('quizId');
                    window.history.replaceState({}, '', url.toString());
                  } catch {}
                }}
              />
            </div>
            {attemptsQuizId != null && <AdminAttempts token={token} quizId={attemptsQuizId} onOpenSession={(userId) => {
              // Switch tab and trigger Sessions to auto-open via sessionStorage handshake
              setAdminTab('sessions');
              // Sessions component reads admin_target_session and auto-joins or opens offline analysis
            }} />}
          </div>
        )}
      </div>
    );
  }

  // Student dashboard
  return (
    <div className="container">
      <h2 className="heading">Student Dashboard</h2>
      <StudentDashboard token={token} onStart={(q, a) => { setQuiz(q); setAttempt(a); }} />
    </div>
  );
}
