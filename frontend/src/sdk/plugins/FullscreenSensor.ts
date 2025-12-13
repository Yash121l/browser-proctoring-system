import { ProctorEvent, SensorPlugin } from "../../core/types";

/**
 * FullscreenSensor
 * Requests fullscreen (if not in fullscreen) and records exit as a violation.
 */
export class FullscreenSensor implements SensorPlugin {
  private onViolation: (evt: ProctorEvent) => void;
  private autoRequest: boolean;
  private initGraceMs: number;
  private startedAt = 0;

  constructor(opts: { onViolation: (evt: ProctorEvent) => void; autoRequest?: boolean; initGraceMs?: number }) {
    this.onViolation = opts.onViolation;
    this.autoRequest = !!opts.autoRequest;
    this.initGraceMs = opts.initGraceMs ?? 1500;
  }

  async init() { /* no-op */ }

  start() {
    this.startedAt = Date.now();
    const el = document.documentElement;
    if (this.autoRequest && !document.fullscreenElement) {
      el.requestFullscreen().catch(() => {
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
    // Ignore transient changes immediately after init to avoid false positives
    if (!document.fullscreenElement) {
      const now = Date.now();
      if (now - this.startedAt < this.initGraceMs) return;
      try {
        const sup = (window as any).__proctor_suppress_fs_until as number | undefined;
        if (typeof sup === 'number' && now < sup) return;
      } catch {}
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
