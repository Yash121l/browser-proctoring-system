import { ProctorEvent, SensorPlugin } from "../../core/types";

/**
 * FullscreenSensor
 * Requests fullscreen (if not in fullscreen) and records exit as a violation.
 */
export class FullscreenSensor implements SensorPlugin {
  private onViolation: (evt: ProctorEvent) => void;

  constructor(opts: { onViolation: (evt: ProctorEvent) => void }) {
    this.onViolation = opts.onViolation;
  }

  async init() { /* no-op */ }

  start() {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => {
        // Record inability to enter fullscreen as violation
        this.onViolation({
          type: "fullscreen_violation",
          testId: "",
          userId: "",
          timestamp: new Date().toISOString(),
          details: { reason: "permission_denied_or_blocked" },
        });
      });
    }
    document.addEventListener("fullscreenchange", this.handleChange, false);
  }

  stop() {
    document.removeEventListener("fullscreenchange", this.handleChange, false);
  }

  destroy() { /* no-op */ }

  private handleChange = () => {
    if (!document.fullscreenElement) {
      this.onViolation({
        type: "fullscreen_exit",
        testId: "",
        userId: "",
        timestamp: new Date().toISOString(),
        details: { reason: "user_exited" },
      });
    }
  };
}

