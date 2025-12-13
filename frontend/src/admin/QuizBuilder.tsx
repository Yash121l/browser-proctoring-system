import React from "react";

type Question = {
  type: "MCQ" | "TRUE_FALSE" | "SHORT_TEXT";
  text: string;
  options?: string[];
  correctAnswer?: any;
  points?: number;
};

export default function QuizBuilder({ token, initialQuiz, onSaved }: { token: string; initialQuiz?: any; onSaved?: () => void }) {
  const [title, setTitle] = React.useState(initialQuiz?.title || "");
  const [description, setDescription] = React.useState(initialQuiz?.description || "");
  const [proctorEnabled, setProctorEnabled] = React.useState(Boolean(initialQuiz?.proctorEnabled ?? true));
  const [proctorConfig, setProctorConfig] = React.useState<string>(JSON.stringify(initialQuiz?.proctorConfig ?? {
    checks: { forceFullScreen: true, tabSwitchDetection: true, cameraMonitoring: true, faceDetection: true, multipleFaceDetection: true, objectDetection: false, audioMonitoring: false, screenRecording: false },
    thresholds: { maxTabSwitches: 3, noiseThreshold: 0.2, gazeToleranceSeconds: 5 },
    durationMinutes: 30,
    heartbeatIntervalMs: 5000, frameCaptureIntervalMs: 200
  }, null, 2));
  const [questions, setQuestions] = React.useState<Question[]>(() => (initialQuiz?.questions || []).map((q: any) => ({
    type: q.type,
    text: q.text,
    options: q.options || undefined,
    correctAnswer: q.correctAnswer ?? undefined,
    points: q.points ?? 1,
  })));
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string>("");
  const isEditing = Boolean(initialQuiz?.id);

  const addQuestion = (type: Question["type"]) => {
    setQuestions((prev) => [...prev, { type, text: "", options: type === "MCQ" ? ["Option 1", "Option 2"] : undefined, correctAnswer: type === "TRUE_FALSE" ? true : undefined, points: 1 }]);
  };

  const updateQuestion = (idx: number, patch: Partial<Question>) => {
    setQuestions((prev) => prev.map((q, i) => (i === idx ? { ...q, ...patch } : q)));
  };

  const moveQuestion = (idx: number, dir: -1 | 1) => {
    setQuestions((prev) => {
      const next = prev.slice();
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const duplicateQuestion = (idx: number) => {
    setQuestions((prev) => {
      const next = prev.slice();
      const copy = { ...next[idx], text: next[idx].text + " (copy)" } as Question;
      next.splice(idx + 1, 0, copy);
      return next;
    });
  };

  const save = async () => {
    setSaving(true); setMessage("");
    try {
      const body = {
        title,
        description,
        proctorEnabled,
        proctorConfig: JSON.parse(proctorConfig),
        questions: questions.map((q) => ({ type: q.type, text: q.text, options: q.options, correctAnswer: q.correctAnswer, points: q.points }))
      };
      const url = isEditing ? `/api/quizzes/${initialQuiz.id}` : "/api/quizzes";
      const method = isEditing ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      setMessage("Quiz saved successfully.");
      if (!isEditing) { setTitle(""); setDescription(""); setQuestions([]); }
      onSaved?.();
      // Try to auto-refresh the quizzes list if present
      try { (window as any).refreshQuizzes?.(); } catch {}
    } catch (e: any) {
      setMessage(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <h3 className="heading">{isEditing ? "Edit Quiz" : "Quiz Builder"}</h3>
      <div className="row" style={{ gap: 20, marginTop: 12 }}>
        <input className="input grow" placeholder="Quiz title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={proctorEnabled} onChange={(e) => setProctorEnabled(e.target.checked)} /> Proctoring
        </label>
        <button className="btn" onClick={() => addQuestion("MCQ")}>Add MCQ</button>
        <button className="btn secondary" onClick={() => addQuestion("TRUE_FALSE")}>Add True/False</button>
        <button className="btn secondary" onClick={() => addQuestion("SHORT_TEXT")}>Add Short Text</button>
      </div>
      <textarea className="input" style={{ width: "100%", marginTop: 8, minHeight: 60 }} placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="card" style={{ marginTop: 12 }}>
        <h4>Questions</h4>
        {questions.length === 0 && <p className="muted">No questions yet. Add one above.</p>}
        {questions.map((q, i) => (
          <div key={i} className="card" style={{ marginTop: 10 }}>
            <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
              <div className="row" style={{ gap: 8, flex: 1 }}>
                <select className="select" value={q.type} onChange={(e) => updateQuestion(i, { type: e.target.value as any })}>
                  <option value="MCQ">MCQ</option>
                  <option value="TRUE_FALSE">True/False</option>
                  <option value="SHORT_TEXT">Short Text</option>
                </select>
                <input className="input grow" placeholder="Question text" value={q.text} onChange={(e) => updateQuestion(i, { text: e.target.value })} />
                <input className="input" style={{ width: 80 }} type="number" value={q.points ?? 1} onChange={(e) => updateQuestion(i, { points: Number(e.target.value) })} />
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn secondary" title="Move up" onClick={() => moveQuestion(i, -1)}>↑</button>
                <button className="btn secondary" title="Move down" onClick={() => moveQuestion(i, +1)}>↓</button>
                <button className="btn secondary" title="Duplicate" onClick={() => duplicateQuestion(i)}>⎘</button>
                <button className="btn danger" onClick={() => setQuestions((prev) => prev.filter((_, idx) => idx !== i))}>Remove</button>
              </div>
            </div>
            {q.type === "MCQ" && (
              <div style={{ marginTop: 8 }}>
                <h5>Options</h5>
                {(q.options || []).map((opt, idx) => (
                  <div key={idx} className="row" style={{ marginTop: 6 }}>
                    <input className="input grow" value={opt} onChange={(e) => {
                      const copy = (q.options || []).slice(); copy[idx] = e.target.value; updateQuestion(i, { options: copy });
                    }} />
                    <label className="row" style={{ gap: 6 }}>
                      <input type="radio" name={`correct-${i}`} checked={q.correctAnswer === opt} onChange={() => updateQuestion(i, { correctAnswer: opt })} /> Correct
                    </label>
                    <button className="btn secondary" onClick={() => {
                      const copy = (q.options || []).slice(); copy.splice(idx,1); updateQuestion(i, { options: copy });
                    }}>Remove</button>
                  </div>
                ))}
                <button className="btn secondary" style={{ marginTop: 6 }} onClick={() => updateQuestion(i, { options: [...(q.options || []), "New option"] })}>Add Option</button>
              </div>
            )}
            {q.type === "TRUE_FALSE" && (
              <div style={{ marginTop: 8 }}>
                <label className="row" style={{ gap: 6 }}>
                  <input type="radio" name={`tf-${i}`} checked={q.correctAnswer === true} onChange={() => updateQuestion(i, { correctAnswer: true })} /> True
                </label>
                <label className="row" style={{ gap: 6 }}>
                  <input type="radio" name={`tf-${i}`} checked={q.correctAnswer === false} onChange={() => updateQuestion(i, { correctAnswer: false })} /> False
                </label>
              </div>
            )}
            {q.type === "SHORT_TEXT" && (
              <div style={{ marginTop: 8 }}>
                <input className="input" placeholder="Reference answer (optional)" value={q.correctAnswer ?? ""} onChange={(e) => updateQuestion(i, { correctAnswer: e.target.value })} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h4>Proctor Settings</h4>
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          {[
            { key: "forceFullScreen", label: "Force Fullscreen" },
            { key: "tabSwitchDetection", label: "Tab Switch Detection" },
            { key: "cameraMonitoring", label: "Camera Monitoring" },
            { key: "faceDetection", label: "Face Detection" },
            { key: "multipleFaceDetection", label: "Multiple Faces" },
            { key: "objectDetection", label: "Object Detection" },
            { key: "audioMonitoring", label: "Audio Monitoring" },
            { key: "screenRecording", label: "Screen Recording" },
          ].map((c) => (
            <label key={c.key} className="row" style={{ gap: 8, minWidth: 220 }}>
              <input
                type="checkbox"
                checked={Boolean((JSON.parse(proctorConfig).checks || {})[c.key])}
                onChange={(e) => {
                  const cfg = JSON.parse(proctorConfig);
                  cfg.checks = cfg.checks || {};
                  cfg.checks[c.key] = e.target.checked;
                  setProctorConfig(JSON.stringify(cfg, null, 2));
                }}
              /> {c.label}
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <label className="row" style={{ gap: 8 }}>
            Duration (minutes)
            <input
              className="input"
              style={{ width: 120 }}
              type="number"
              value={Number((JSON.parse(proctorConfig).durationMinutes ?? 30))}
              onChange={(e) => {
                const cfg = JSON.parse(proctorConfig);
                cfg.durationMinutes = Number(e.target.value);
                setProctorConfig(JSON.stringify(cfg, null, 2));
              }}
            />
          </label>
          <label className="row" style={{ gap: 8 }}>
            Screen snapshot interval (ms)
            <input
              className="input"
              style={{ width: 160 }}
              type="number"
              value={Number((JSON.parse(proctorConfig).screenSnapshotIntervalMs ?? 30000))}
              onChange={(e) => {
                const cfg = JSON.parse(proctorConfig);
                cfg.screenSnapshotIntervalMs = Number(e.target.value);
                setProctorConfig(JSON.stringify(cfg, null, 2));
              }}
            />
          </label>
        </div>
        <h4 style={{ marginTop: 12 }}>Advanced (JSON)</h4>
        <textarea className="input" style={{ width: "100%", minHeight: 160 }} value={proctorConfig} onChange={(e) => setProctorConfig(e.target.value)} />
      </div>

      <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
        <button className="btn" disabled={saving} onClick={save}>{saving ? (isEditing ? "Updating..." : "Saving...") : (isEditing ? "Update Quiz" : "Save Quiz")}</button>
      </div>
      {message && <p className="muted" style={{ marginTop: 8 }}>{message}</p>}
    </div>
  );
}
