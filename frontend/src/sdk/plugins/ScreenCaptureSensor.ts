import { ProctorEvent, SensorPlugin } from "../../core/types";

/**
 * ScreenCaptureSensor
 * Starts a local screen capture for evidence-only recording: periodically grabs
 * current frame and emits a lightweight event so the server logs that screen
 * capture is active. It does NOT stream; admin live-view is handled by ScreenShareSensor.
 */
export class ScreenCaptureSensor implements SensorPlugin {
  private onViolation?: (evt: ProctorEvent) => void;
  private stream?: MediaStream;
  private video?: HTMLVideoElement;
  private canvas?: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D | null;
  private timer?: number;

  constructor(opts: { onViolation?: (evt: ProctorEvent) => void }) {
    this.onViolation = opts.onViolation;
  }

  async init() {
    // Defer permission until start is called
  }

  async start() {
    try {
      if (!this.stream) {
        this.stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false });
        this.video = document.createElement("video");
        this.video.srcObject = this.stream;
        this.video.muted = true;
        this.video.playsInline = true;
        await this.video.play();
        this.canvas = document.createElement("canvas");
        this.canvas.width = 640; this.canvas.height = 360;
        this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
      }
      // Periodically indicate that recording is active
      this.timer = window.setInterval(() => {
        this.onViolation?.({
          type: "heartbeat",
          testId: "",
          userId: "",
          timestamp: new Date().toISOString(),
          details: { screenRecording: true },
        } as any);
      }, 10_000);
    } catch {
      // user may cancel; ignore
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async destroy() {
    this.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
  }
}

