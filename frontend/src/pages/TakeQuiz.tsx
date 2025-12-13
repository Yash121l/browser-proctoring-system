import React from "react";
import { ProctorSDK } from "../sdk/ProctorSDK";
import type { ProctorConfig } from "../core/types";
import PreflightChecks from "./PreflightChecks";

export default function TakeQuiz({ token, quiz, attempt, onSubmitted }: { token: string; quiz: any; attempt: any; onSubmitted: () => void }) {
  const [sdk, setSdk] = React.useState<ProctorSDK | null>(null);
  const [answers, setAnswers] = React.useState<Record<number, any>>({});
  const [timeLeft, setTimeLeft] = React.useState<number | null>(() => {
    const mins = quiz?.proctorConfig?.durationMinutes ?? null;
    return typeof mins === 'number' ? mins * 60 : null;
  });
  const [needsRecheck, setNeedsRecheck] = React.useState(false);
  const [preview, setPreview] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Attach violation handler that auto-stops on critical proctoring loss
    (window as any).onViolationHandler = (evt: any) => {
      console.log("Violation:", evt);
      const t = evt?.type as string;
      // If fullscreen is exited or multiple faces persist, force submit
      if (t === 'fullscreen_exit' || t === 'admin_forced_stop') submit();
      if (t === 'camera_stopped' || t === 'screen_share_stopped') setNeedsRecheck(true);
    };
    (window as any).onForceSubmitHandler = () => submit();
  }, []);

  const [reinitSeq, setReinitSeq] = React.useState(0);

  React.useEffect(() => {
    if (!quiz?.proctorEnabled) return; // No proctoring
    const qc = quiz?.proctorConfig || {};
    const checks = {
      forceFullScreen: true,
      tabSwitchDetection: true,
      cameraMonitoring: true,
      audioMonitoring: false,
      screenRecording: !!(qc?.checks?.screenRecording ?? true),
      faceDetection: !!(qc?.checks?.faceDetection ?? true),
      multipleFaceDetection: !!(qc?.checks?.multipleFaceDetection ?? true),
      objectDetection: !!(qc?.checks?.objectDetection ?? false),
    };
    const cfg: ProctorConfig = {
      testId: String(quiz.id),
      userId: String(attempt.userId ?? "student"),
      attemptId: Number(attempt.id),
      checks,
      thresholds: {
        maxTabSwitches: qc?.thresholds?.maxTabSwitches ?? 3,
        noiseThreshold: qc?.thresholds?.noiseThreshold ?? 0.2,
        gazeToleranceSeconds: qc?.thresholds?.gazeToleranceSeconds ?? 5,
      },
      callbacks: { onViolation: "window.onViolationHandler", onForceSubmit: "window.onForceSubmitHandler", onScreenPreview: "window.onScreenPreview" },
      heartbeatIntervalMs: qc?.heartbeatIntervalMs ?? 5000,
      frameCaptureIntervalMs: qc?.frameCaptureIntervalMs ?? 200,
      screenSnapshotIntervalMs: qc?.screenSnapshotIntervalMs ?? 30000,
    } as any;
    const instance = new ProctorSDK(cfg);
    // Use per-attempt WS token for correct sub/testId pairing
    const wsToken = sessionStorage.getItem("candidate_ws_token") || token;
    instance.setToken(wsToken);
    let mounted = true;
    // Wire preview callback
    (window as any).onScreenPreview = (d: string) => setPreview(d);
    instance.init().then(() => { if (mounted) setSdk(instance); });
    return () => { mounted = false; instance.destroy(); };
  }, [quiz, attempt, token, reinitSeq]);

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

  // When recheck is needed, stop current proctor session
  React.useEffect(() => {
    if (needsRecheck) {
      (async () => { try { await sdk?.destroy(); } catch {} finally { setSdk(null); } })();
    }
  }, [needsRecheck]);

  const fmt = (s: number) => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;

  if (needsRecheck) {
    return (
      <div>
        <PreflightChecks onReady={async () => { setNeedsRecheck(false); setReinitSeq((n) => n + 1); }} require={{ camera: true, screen: true, fullscreen: true }} />
      </div>
    );
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <h3 className="heading">{quiz.title}</h3>
        <div className="row" style={{ gap: 16 }}>
          <div className="muted">Progress: {progress}%</div>
          {timeLeft != null && <div className="muted">Time: {fmt(timeLeft)}</div>}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Proctoring active: Camera, Tab Switch, Fullscreen{quiz?.proctorConfig?.checks?.screenRecording ? ", Screen" : ""}</div>
      <div style={{ height: 8, background: "#1e2747", borderRadius: 6, overflow: "hidden", marginBottom: 12 }}>
        <div style={{ width: `${progress}%`, height: "100%", background: "linear-gradient(135deg, var(--accent), #8aa6ff)" }} />
      </div>
      {preview && (
        <div style={{ position: 'fixed', right: 24, bottom: 24, background: 'rgba(0,0,0,0.6)', padding: 6, borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="muted" style={{ fontSize: 10, marginBottom: 4 }}>Screen preview</div>
          <img src={preview} style={{ width: 200, height: 'auto', display: 'block', borderRadius: 6 }} />
        </div>
      )}
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
      <div className="row" style={{ justifyContent: "space-between", marginTop: 12 }}>
        <div className="muted" style={{ fontSize: 12 }}>Snapshots: camera on violations; screen periodic</div>
        <button className="btn" onClick={submit}>Submit</button>
      </div>
    </div>
  );
}
