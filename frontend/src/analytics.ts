import posthog from "posthog-js";

// PostHog product analytics.
//
// Proctored exams are sensitive, so:
// - replays mask every input and every text node, and never record <video>,
//   <canvas>, <img> or <iframe> (webcam feeds, screen previews, evidence
//   snapshots and recordings in the admin console);
// - replay is paused for the whole proctored attempt (pre-flight checks and
//   TakeQuiz), so it never competes with the SDK's camera/screen capture,
//   MediaRecorder and face-detection worker;
// - autocapture does not collect element text or attributes;
// - users are identified by internal id and role only, never email.
//
// The phc_ key is a public client key committed in .env.production. There is
// no known production host to put a reverse proxy on, so events go straight
// to PostHog (override with VITE_POSTHOG_HOST=/ingest behind a proxy).

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || "https://us.i.posthog.com";
const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
const enabled = !!KEY && ((!import.meta.env.DEV && !isLocal) || import.meta.env.VITE_POSTHOG_DEV === "1");

if (enabled) {
  posthog.init(KEY!, {
    api_host: HOST,
    ui_host: "https://us.posthog.com",
    defaults: "2026-08-30",
    person_profiles: "identified_only",
    capture_pageview: "history_change",
    capture_pageleave: true,
    autocapture: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    enable_heatmaps: true,
    capture_dead_clicks: true,
    capture_exceptions: true,
    capture_performance: { web_vitals: true },
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "*",
      blockSelector: "video, canvas, img, iframe, .ph-no-capture",
    },
  });
  posthog.register({ app: "browser-proctoring-system" });
}

type Events = {
  user_signed_up: { role: string };
  user_logged_in: { role: string };
  quiz_saved: { is_new: boolean; question_count: number; proctored: boolean };
  preflight_checks_passed: { camera: boolean; screen: boolean; fullscreen: boolean };
  quiz_attempt_started: { quiz_id: string; proctored: boolean; question_count: number };
  proctor_violation_detected: { quiz_id: string; violation_type: string };
  quiz_submitted: { quiz_id: string; question_count: number; answered_count: number; reason: "manual" | "timeout" | "forced" };
};

export function track<E extends keyof Events>(event: E, props: Events[E]) {
  if (enabled) posthog.capture(event, props);
}

export function identifyUser(user?: { id: string | number; role?: string } | null) {
  if (!enabled || user?.id == null) return;
  // Internal id and role only; no email as a person property.
  posthog.identify(String(user.id), { role: user.role });
}

export function resetAnalytics() {
  if (enabled) posthog.reset();
}

// Pause replay while the proctoring SDK owns the camera and screen. Nested
// callers (TakeQuiz -> PreflightChecks re-check) share one pause.
// stopSessionRecording() sets disable_session_recording, so the recorder also
// stays off if it hadn't loaded yet; startSessionRecording() with no override
// still respects the project's replay settings and sampling.
let pauseDepth = 0;
export function pauseReplay() {
  if (!enabled) return () => {};
  if (pauseDepth++ === 0) posthog.stopSessionRecording();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--pauseDepth === 0) posthog.startSessionRecording();
  };
}
