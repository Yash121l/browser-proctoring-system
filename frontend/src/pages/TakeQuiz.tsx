import React from "react";
import { ProctorSDK } from "../sdk/ProctorSDK";
import type { ProctorConfig } from "../core/types";

export default function TakeQuiz({ token, quiz, attempt, onSubmitted }: { token: string; quiz: any; attempt: any; onSubmitted: () => void }) {
  const [sdk, setSdk] = React.useState<ProctorSDK | null>(null);
  const [answers, setAnswers] = React.useState<Record<number, any>>({});
  const [timeLeft, setTimeLeft] = React.useState<number | null>(() => {
    const mins = quiz?.proctorConfig?.durationMinutes ?? null;
    return typeof mins === 'number' ? mins * 60 : null;
  });

  React.useEffect(() => {
    // Attach simple violation handler
    (window as any).onViolationHandler = (evt: any) => console.log("Violation:", evt);
    (window as any).onForceSubmitHandler = () => submit();
  }, []);

  React.useEffect(() => {
    if (!quiz?.proctorEnabled) return; // No proctoring
    const cfg: ProctorConfig = {
      testId: String(quiz.id),
      userId: String(attempt.userId ?? "student"),
      attemptId: Number(attempt.id),
      checks: {
        forceFullScreen: true,
        tabSwitchDetection: true,
        cameraMonitoring: true,
        audioMonitoring: false,
        screenRecording: true,
        faceDetection: true,
        multipleFaceDetection: true,
        objectDetection: false,
      },
      thresholds: { maxTabSwitches: 3, noiseThreshold: 0.2, gazeToleranceSeconds: 5 },
      callbacks: { onViolation: "window.onViolationHandler", onForceSubmit: "window.onForceSubmitHandler" },
      heartbeatIntervalMs: 5000,
      frameCaptureIntervalMs: 200,
    };
    const instance = new ProctorSDK(cfg);
    // Use per-attempt WS token for correct sub/testId pairing
    const wsToken = sessionStorage.getItem("candidate_ws_token") || token;
    instance.setToken(wsToken);
    instance.init().then(() => setSdk(instance));
    return () => { instance.destroy(); };
  }, [quiz, attempt, token]);

  const onAnswer = (q: any, resp: any) => {
    setAnswers((prev) => ({ ...prev, [q.id]: resp }));
  };

  const submit = async () => {
    await fetch(`/api/attempts/${attempt.id}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ answers }),
    });
    await sdk?.destroy();
    setSdk(null);
    onSubmitted();
  };

  // Timer countdown if duration provided
  React.useEffect(() => {
    if (timeLeft == null) return;
    if (timeLeft <= 0) { submit(); return; }
    const t = window.setTimeout(() => setTimeLeft((s) => (s != null ? s - 1 : s)), 1000);
    return () => clearTimeout(t);
  }, [timeLeft]);

  const progress = (() => {
    const total = quiz?.questions?.length || 0;
    const answered = Object.keys(answers).length;
    return total > 0 ? Math.round((answered / total) * 100) : 0;
  })();

  const fmt = (s: number) => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <h3 className="heading">{quiz.title}</h3>
        <div className="row" style={{ gap: 16 }}>
          <div className="muted">Progress: {progress}%</div>
          {timeLeft != null && <div className="muted">Time: {fmt(timeLeft)}</div>}
        </div>
      </div>
      <div style={{ height: 8, background: "#1e2747", borderRadius: 6, overflow: "hidden", marginBottom: 12 }}>
        <div style={{ width: `${progress}%`, height: "100%", background: "linear-gradient(135deg, var(--accent), #8aa6ff)" }} />
      </div>
      <ol>
        {quiz.questions?.map((q: any) => (
          <li key={q.id} style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 8 }}>{q.text}</div>
            {q.type === "MCQ" && Array.isArray(q.options) && (
              <div>
                {q.options.map((opt: any, idx: number) => (
                  <label key={idx} style={{ display: "block" }}>
                    <input type="radio" name={`q-${q.id}`} onChange={() => onAnswer(q, opt)} /> {String(opt)}
                  </label>
                ))}
              </div>
            )}
            {q.type === "TRUE_FALSE" && (
              <div>
                {([true, false] as const).map((opt) => (
                  <label key={String(opt)} style={{ display: "inline-block", marginRight: 12 }}>
                    <input type="radio" name={`q-${q.id}`} onChange={() => onAnswer(q, opt)} /> {String(opt)}
                  </label>
                ))}
              </div>
            )}
            {q.type === "SHORT_TEXT" && (
              <input style={{ width: 400 }} onChange={(e) => onAnswer(q, e.target.value)} />
            )}
          </li>
        ))}
      </ol>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <button className="btn" onClick={submit}>Submit</button>
      </div>
    </div>
  );
}
