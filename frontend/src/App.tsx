import React from "react";
import { ProctorSDK } from "./sdk/ProctorSDK";
import type { ProctorConfig } from "./core/types";
import AdminPage from "./admin/AdminPage";

/**
 * Demo App
 * Logs in to get a JWT, configures ProctorSDK, and starts monitoring.
 */
export default function App() {
  const params = new URLSearchParams(window.location.search);
  const isAdmin = params.get("admin") === "1";
  if (isAdmin) return <AdminPage />;
  const [sdk, setSdk] = React.useState<ProctorSDK | null>(null);
  const [token, setToken] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string>("idle");

  React.useEffect(() => {
    // Expose sample callbacks
    (window as any).onViolationHandler = (evt: any) => {
      console.log("Violation callback:", evt);
    };
    (window as any).onForceSubmitHandler = () => {
      console.log("Force submit triggered");
    };
  }, []);

  const login = async () => {
    const userId = "user_88";
    const testId = "quiz_101";
    const res = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ userId, testId }),
    });
    if (!res.ok) throw new Error("Login failed");
    const { token } = await res.json();
    setToken(token);
    return { token, userId, testId };
  };

  const start = async () => {
    setStatus("starting");
    const { token, userId, testId } = await login();
    const cfg: ProctorConfig = {
      testId,
      userId,
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
      callbacks: {
        onViolation: "window.onViolationHandler",
        onForceSubmit: "window.onForceSubmitHandler",
      },
      heartbeatIntervalMs: 5000,
      frameCaptureIntervalMs: 200,
    };
    const instance = new ProctorSDK(cfg);
    instance.setToken(token);
    await instance.init();
    setSdk(instance);
    setStatus("running");
  };

  const stop = async () => {
    await sdk?.destroy();
    setSdk(null);
    setStatus("stopped");
  };

  return (
    <div style={{ padding: 24 }}>
      <h2>ProctorSDK Demo</h2>
      <p>Status: {status}</p>
      {!sdk ? <button onClick={start}>Start Proctoring</button> : <button onClick={stop}>Stop</button>}
      {token && <p>JWT acquired</p>}
      <p>Open console to see events and callbacks.</p>
    </div>
  );
}
