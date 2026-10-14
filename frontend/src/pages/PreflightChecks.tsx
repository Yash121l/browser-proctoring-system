import React from "react";
import { pauseReplay, track } from "../analytics";

type Props = {
  onReady: (result: { cam: boolean; mic: boolean; screen: boolean; fullscreen: boolean }) => void;
  require: { camera?: boolean; screen?: boolean; fullscreen?: boolean };
};

export default function PreflightChecks({ onReady, require }: Props) {
  const [camOk, setCamOk] = React.useState(false);
  const [screenOk, setScreenOk] = React.useState(false);
  const [fsOk, setFsOk] = React.useState(document.fullscreenElement != null);
  const [checking, setChecking] = React.useState(false);
  // Camera and screen-share permission prompts happen here; keep replay off.
  React.useEffect(() => pauseReplay(), []);
  const needs = {
    camera: !!require.camera,
    screen: !!require.screen,
    fullscreen: !!require.fullscreen,
  };

  const checkCamera = async () => {
    setChecking(true);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      s.getTracks().forEach((t) => t.stop());
      setCamOk(true);
    } catch {
      setCamOk(false);
    } finally { setChecking(false); }
  };

  const checkScreen = async () => {
    setChecking(true);
    try {
      const s = await (navigator.mediaDevices as any).getDisplayMedia({ video: true });
      s.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      setScreenOk(true);
    } catch { setScreenOk(false); }
    finally { setChecking(false); }
  };

  const goFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
      setFsOk(true);
    } catch {}
  };

  const allOk = (!needs.camera || camOk) && (!needs.screen || screenOk) && (!needs.fullscreen || fsOk);

  return (
    <div className="modal-backdrop"><div className="modal">
      <h3 className="heading">System Check</h3>
      <p className="muted">We’ll verify your setup before starting the quiz.</p>
      <ul className="list" style={{ marginTop: 10 }}>
        {needs.camera && (
          <li>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <strong>Camera</strong>
                <div className="muted" style={{ fontSize: 12 }}>We only capture snapshots on violations.</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <span className="muted">{camOk ? "Ready" : "Not checked"}</span>
                <button className="btn secondary" disabled={checking} onClick={checkCamera}>Test</button>
              </div>
            </div>
          </li>
        )}
        {needs.screen && (
          <li>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <strong>Screen Sharing</strong>
                <div className="muted" style={{ fontSize: 12 }}>We’ll ask only if a proctor requests.</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <span className="muted">{screenOk ? "Ready" : "Not checked"}</span>
                <button className="btn secondary" disabled={checking} onClick={checkScreen}>Test</button>
              </div>
            </div>
          </li>
        )}
        {needs.fullscreen && (
          <li>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <strong>Fullscreen</strong>
                <div className="muted" style={{ fontSize: 12 }}>Your quiz runs in fullscreen mode.</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <span className="muted">{fsOk ? "Enabled" : "Disabled"}</span>
                <button className="btn secondary" onClick={goFullscreen}>Enter</button>
              </div>
            </div>
          </li>
        )}
      </ul>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <button className="btn" disabled={!allOk} onClick={() => {
          track("preflight_checks_passed", { camera: camOk, screen: screenOk, fullscreen: fsOk });
          onReady({ cam: camOk, mic: false, screen: screenOk, fullscreen: fsOk });
        }}>Continue</button>
      </div>
    </div></div>
  );
}
