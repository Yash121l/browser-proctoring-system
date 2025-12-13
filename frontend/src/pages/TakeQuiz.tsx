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
  const [showCam, setShowCam] = React.useState(false);
  const camRef = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    // Attach violation handler that auto-stops on critical proctoring loss
    (window as any).onViolationHandler = (evt: any) => {
      console.log("Violation:", evt);
      const t = evt?.type as string;
      // Fullscreen exit or device stop -> pause and re-check
      if (t === 'fullscreen_exit') setNeedsRecheck(true);
      // Admin forced stop -> submit immediately
      if (t === 'admin_forced_stop') submit();
      if (t === 'camera_stopped' || t === 'screen_share_stopped') setNeedsRecheck(true);
    };
    (window as any).onForceSubmitHandler = () => submit();
    (window as any).onRecordingStatus = (s: { source: 'screen'|'camera'; active: boolean }) => {
      // simple UI indicator by toggling a CSS class on body for now
      try {
        const id = `rec-${s.source}`;
        const el = document.getElementById(id);
        if (el) el.textContent = s.active ? `${s.source.toUpperCase()} REC` : `${s.source.toUpperCase()} idle`;
      } catch {}
    };
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

  // Candidate camera preview toggle
  React.useEffect(() => {
    if (!showCam) return;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (camRef.current) camRef.current.srcObject = stream;
      } catch {}
    })();
    return () => { try { stream?.getTracks().forEach((t) => t.stop()); } catch {} };
  }, [showCam]);

  const onAnswer = (q: any, resp: any) => {
    setAnswers((prev) => ({ ...prev, [q.id]: resp }));
  };

  // Stepper state
  const [step, setStep] = React.useState(0);
  const [review, setReview] = React.useState<Record<number, boolean>>({});
  const total = quiz?.questions?.length || 0;
  const qAt = quiz?.questions?.[step];
  const toggleReview = (qid: number) => setReview((r) => ({ ...r, [qid]: !r[qid] }));

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
    <div className="container">
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 className="heading">{quiz.title}</h3>
          <div className="row" style={{ gap: 12 }}>
            <div className="chip current">Progress {progress}%</div>
            {timeLeft != null && <div className="chip">Time {fmt(timeLeft)}</div>}
            <div id="rec-screen" className="chip">SCREEN idle</div>
            <div id="rec-camera" className="chip">CAMERA idle</div>
          </div>
        </div>
        <div className="toolbar">
          <div className="muted" style={{ fontSize: 12 }}>Proctoring: Camera, Tab Switch, Fullscreen{quiz?.proctorConfig?.checks?.screenRecording ? ", Screen" : ""}</div>
          <div style={{ flex: 1, height: 8, background: "#1e2747", borderRadius: 6, overflow: "hidden", marginLeft: 12 }}>
            <div style={{ width: `${progress}%`, height: "100%", background: "linear-gradient(135deg, var(--accent), #8aa6ff)" }} />
          </div>
        </div>
      </div>
      {preview && (
        <div style={{ position: 'fixed', right: 24, bottom: 24, background: 'rgba(0,0,0,0.6)', padding: 6, borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="muted" style={{ fontSize: 10, marginBottom: 4 }}>Screen preview</div>
          <img src={preview} style={{ width: 200, height: 'auto', display: 'block', borderRadius: 6 }} />
        </div>
      )}
      <div style={{ position: 'fixed', right: 24, bottom: preview ? 160 : 24, background: 'rgba(0,0,0,0.6)', padding: 6, borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn secondary" onClick={() => setShowCam((s) => !s)}>{showCam ? 'Hide' : 'Show'} camera</button>
          {quiz?.proctorConfig?.checks?.screenRecording && <span className="chip">REC</span>}
        </div>
        {showCam && <video ref={camRef} autoPlay playsInline muted style={{ width: 200, height: 'auto', display: 'block', borderRadius: 6, marginTop: 6 }} />}
      </div>
      {/* Sticky toolbar chips */}
      <div className="card" style={{ position: 'sticky', top: 0, zIndex: 5, marginBottom: 12 }}>
        <div className="chips">
          {quiz.questions?.map((q: any, i: number) => {
            const answered = answers[q.id] != null;
            const classes = ["chip", i === step ? "current" : "", review[q.id] ? "review" : answered ? "attempted" : ""].filter(Boolean).join(" ");
            return (<button key={q.id} className={classes} onClick={() => setStep(i)}>{i+1}</button>);
          })}
        </div>
      </div>

      {/* Single-question panel */}
      {qAt && (
        <div className="card" style={{ padding: 24 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div><strong>Question {step+1} of {total}</strong></div>
            <button className="btn secondary" onClick={() => toggleReview(qAt.id)}>{review[qAt.id] ? 'Unmark' : 'Mark for review'}</button>
          </div>
          <div style={{ marginTop: 10, marginBottom: 12, lineHeight: 1.5 }}>{qAt.text}</div>
          {qAt.type === 'MCQ' && Array.isArray(qAt.options) && (
            <div style={{ display: 'grid', gap: 8 }}>
              {qAt.options.map((opt: any, idx: number) => (
                <label key={idx} style={{ display: 'block', padding: '10px 12px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}>
                  <input type="radio" name={`q-${qAt.id}`} checked={answers[qAt.id] === opt} onChange={() => onAnswer(qAt, opt)} /> {String(opt)}
                </label>
              ))}
            </div>
          )}
          {qAt.type === 'TRUE_FALSE' && (
            <div>
              {([true,false] as const).map((opt) => (
                <label key={String(opt)} style={{ display: 'inline-block', marginRight: 12, padding: '10px 12px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}>
                  <input type="radio" name={`q-${qAt.id}`} checked={answers[qAt.id] === opt} onChange={() => onAnswer(qAt, opt)} /> {String(opt)}
                </label>
              ))}
            </div>
          )}
          {qAt.type === 'SHORT_TEXT' && (
            <input className="input" style={{ width: '100%', maxWidth: 520 }} value={answers[qAt.id] ?? ''} onChange={(e) => onAnswer(qAt, e.target.value)} />
          )}
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
            <button className="btn secondary" onClick={() => setStep((s) => Math.max(0, s-1))}>Previous</button>
            <button className="btn" onClick={() => setStep((s) => Math.min(total-1, s+1))}>Next</button>
          </div>
        </div>
      )}
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn secondary" onClick={() => {
            const idx = quiz.questions?.findIndex((x: any) => answers[x.id] == null) ?? -1;
            if (idx >= 0) setStep(idx);
          }}>Unanswered only</button>
          <button className="btn secondary" onClick={() => {
            const idx = quiz.questions?.findIndex((x: any) => review[x.id]) ?? -1;
            if (idx >= 0) setStep(idx);
          }}>Marked for review</button>
        </div>
        <button className="btn" onClick={submit}>Submit</button>
      </div>
    </div>
  );
}
