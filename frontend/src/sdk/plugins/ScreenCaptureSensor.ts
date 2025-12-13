import { ProctorEvent, SensorPlugin } from "../../core/types";
import { presignAndUpload, uploadDirect } from "../../utils/upload";

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
  private testId: string;
  private userId: string;
  private token: string;
  private apiBase: string;
  private interval: number;
  private onPreview?: (dataUrl: string) => void;

  constructor(opts: { onViolation?: (evt: ProctorEvent) => void; onPreview?: (dataUrl: string) => void; testId: string; userId: string; token: string; apiBaseUrl: string; snapshotIntervalMs?: number }) {
    this.onViolation = opts.onViolation;
    this.testId = opts.testId;
    this.userId = opts.userId;
    this.token = opts.token;
    this.apiBase = opts.apiBaseUrl;
    this.interval = Math.max(5000, opts.snapshotIntervalMs ?? 30_000);
    this.onPreview = opts.onPreview;
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
        try {
          this.stream.getVideoTracks().forEach((t) => {
            t.addEventListener("ended", () => {
              this.onViolation?.({
                type: "screen_share_stopped",
                testId: this.testId,
                userId: this.userId,
                timestamp: new Date().toISOString(),
                details: { reason: "track_ended" },
              } as any);
            });
          });
        } catch {}
      }
      // Periodically capture a frame and upload as evidence
      this.timer = window.setInterval(async () => {
        try {
          if (!this.canvas || !this.ctx || !this.video) return;
          this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
          try {
            const dataUrl = this.canvas.toDataURL("image/jpeg", 0.6);
            this.onPreview?.(dataUrl);
          } catch {}
          const blob: Blob = await new Promise((resolve) => this.canvas!.toBlob((b) => resolve(b!), "image/jpeg", 0.8));
          let url: string | undefined; let key: string | undefined; let viewUrl: string | undefined;
          try {
            const r = await presignAndUpload({
              token: this.token,
              apiBaseUrl: this.apiBase,
              blob,
              contentType: "image/jpeg",
              testId: this.testId,
              userId: this.userId,
            });
            url = r.url; key = r.key; viewUrl = r.viewUrl;
          } catch {
            // Fallback: direct upload through backend to avoid S3 CORS preflight
            const r = await uploadDirect({
              token: this.token,
              apiBaseUrl: this.apiBase,
              blob,
              contentType: "image/jpeg",
              testId: this.testId,
              userId: this.userId,
            });
            url = r.url; key = r.key; viewUrl = r.url;
          }
          this.onViolation?.({
            type: "screen_snapshot",
            testId: this.testId,
            userId: this.userId,
            timestamp: new Date().toISOString(),
            details: { intervalMs: this.interval },
            evidence: { type: "image/jpeg", url: viewUrl || url, key },
          } as any);
        } catch {
          /* ignore periodic upload errors */
        }
      }, this.interval);
    } catch {
      // user may cancel; ignore
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async destroy() {
    this.stop();
    try {
      this.stream?.getTracks().forEach((t) => t.stop());
    } catch {}
    this.stream = undefined;
  }
}
