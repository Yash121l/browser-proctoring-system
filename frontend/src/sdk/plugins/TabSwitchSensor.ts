import { ProctorEvent, SensorPlugin } from "../../core/types";

/**
 * TabSwitchSensor
 * Counts visibility changes (tab switches) and emits violation after threshold.
 */
export class TabSwitchSensor implements SensorPlugin {
  private onViolation: (evt: ProctorEvent) => void;
  private max: number;
  private count = 0;

  constructor(opts: { maxTabSwitches: number; onViolation: (evt: ProctorEvent) => void }) {
    this.onViolation = opts.onViolation;
    this.max = opts.maxTabSwitches;
  }

  async init() { /* no-op */ }

  start() {
    document.addEventListener("visibilitychange", this.handle, false);
  }

  stop() {
    document.removeEventListener("visibilitychange", this.handle, false);
  }

  destroy() { /* no-op */ }

  private handle = () => {
    if (document.hidden) {
      this.count += 1;
      if (this.count > this.max) {
        this.onViolation({
          type: "tab_switch_limit_exceeded",
          testId: "",
          userId: "",
          timestamp: new Date().toISOString(),
          details: { count: this.count, max: this.max },
        });
      } else {
        this.onViolation({
          type: "tab_switch",
          testId: "",
          userId: "",
          timestamp: new Date().toISOString(),
          details: { count: this.count },
        });
      }
    }
  };
}

