import React from "react";
import { ProctorSDK } from "../sdk/ProctorSDK";
import type { ProctorConfig } from "../core/types";

export default function TakeQuiz({ token, quiz, attempt, onSubmitted }: { token: string; quiz: any; attempt: any; onSubmitted: () => void }) {
  const [sdk, setSdk] = React.useState<ProctorSDK | null>(null);
  const [answers, setAnswers] = React.useState<Record<number, any>>({});

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
        screenRecording: false,
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
    instance.setToken(token);
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

  return (
    <div>
      <h3>{quiz.title}</h3>
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
      <button onClick={submit}>Submit</button>
    </div>
  );
}

