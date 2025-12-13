import { ProctorEvent, SensorPlugin } from "../../core/types";

/**
 * CameraSensor
 * Captures frames at an interval, sends to face.worker for presence/count checks.
 * Emits violations for zero-face or multiple-face conditions, and provides a JPEG
 * snapshot blob for evidence upload (only on events).
 */
export class CameraSensor implements SensorPlugin {
  private worker?: Worker;
  private stream?: MediaStream;
  private video?: HTMLVideoElement;
  private canvas?: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D | null;
  private timer?: number;

  private onViolation: (evt: ProctorEvent, snapshotBlob?: Blob) => void;
  private interval: number;
  private faceDetection: boolean;
  private multipleFaceDetection: boolean;

  constructor(opts: {
    onViolation: (evt: ProctorEvent, snapshotBlob?: Blob) => void;
    frameIntervalMs: number;
    faceDetection: boolean;
    multipleFaceDetection: boolean;
  }) {
    this.onViolation = opts.onViolation;
    this.interval = opts.frameIntervalMs;
    this.faceDetection = opts.faceDetection;
    this.multipleFaceDetection = opts.multipleFaceDetection;
  }

  /**
   * init
   * Requests camera; sets up video/canvas; starts worker.
   * Failure modes: permission denied; no devices; worker load error.
   */
  async init() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = this.stream;
    await this.video.play();

    this.canvas = document.createElement("canvas");
    this.canvas.width = 640;
    this.canvas.height = 480;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });

    // Vite-friendly worker import
    this.worker = new Worker(new URL("../../ai/face.worker.ts", import.meta.url), {
      type: "module",
    });

    // Detect camera being turned off (track ended)
    try {
      this.stream.getVideoTracks().forEach((t) => {
        t.addEventListener("ended", () => {
          this.onViolation(
            {
              type: "camera_stopped",
              testId: "",
              userId: "",
              timestamp: new Date().toISOString(),
              details: { reason: "track_ended" },
            },
            undefined,
          );
        });
      });
    } catch {}
  }

  /**
   * start
   * Begins periodic frame capture and worker inference.
   */
  start() {
    this.timer = window.setInterval(async () => {
      if (!this.video || !this.canvas || !this.ctx || !this.worker) return;
      if (!this.faceDetection) return;

      // Draw current frame to canvas
      this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      const bitmap = await createImageBitmap(this.canvas);
      this.worker.postMessage({ type: "analyze", frame: bitmap }, [bitmap as any]);

      const result: { faceCount: number } = await new Promise((resolve) => {
        const handler = (e: MessageEvent) => {
          if ((e.data as any)?.type === "result") {
            this.worker!.removeEventListener("message", handler);
            resolve({ faceCount: (e.data as any).faceCount });
          }
        };
        this.worker!.addEventListener("message", handler, { once: true });
      });

      // Violation checks
      if (result.faceCount === 0) {
        const blob = await this.snapshot();
        this.onViolation(
          {
            type: "no_face_detected",
            testId: "",
            userId: "",
            timestamp: new Date().toISOString(),
            details: {},
          },
          blob,
        );
      } else if (this.multipleFaceDetection && result.faceCount > 1) {
        const blob = await this.snapshot();
        this.onViolation(
          {
            type: "multiple_faces_detected",
            testId: "",
            userId: "",
            timestamp: new Date().toISOString(),
            details: { faceCount: result.faceCount },
          },
          blob,
        );
      }
    }, this.interval);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * destroy
   * Stops tracks and terminates worker.
   */
  async destroy() {
    this.stop();
    this.worker?.terminate();
    this.stream?.getTracks().forEach((t) => t.stop());
  }

  /**
   * snapshot
   * Returns a single JPEG Blob of current frame for evidence upload.
   */
  private async snapshot(): Promise<Blob> {
    if (!this.canvas || !this.ctx || !this.video) throw new Error("No canvas/video");
    this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    const blob: Blob = await new Promise((resolve) =>
      this.canvas!.toBlob((b) => resolve(b!), "image/jpeg", 0.9),
    );
    return blob;
  }
}
