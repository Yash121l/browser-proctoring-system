import { SensorPlugin } from "../../core/types";
import { uploadDirect, presignAndUpload } from "../../utils/upload";

export class ScreenRecorder implements SensorPlugin {
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private running = false;

  constructor(private opts: { token: string; apiBaseUrl: string; testId: string; userId: string; chunkMs?: number; mimeType?: string }) {}

  async init() {
    // Lazy permission; recorder starts on start()
  }

  async start() {
    if (this.running) return;
    this.running = true;
    try {
      this.stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: { frameRate: 12 }, audio: false });
      const mime = this.opts.mimeType ?? 'video/webm;codecs=vp8';
      this.recorder = new MediaRecorder(this.stream, { mimeType: mime } as any);
      this.recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) this.chunks.push(e.data); };
      this.recorder.onstop = () => this.flush();
      const chunkMs = Math.max(5000, this.opts.chunkMs ?? 60000);
      this.recorder.start(chunkMs);
      // Periodic flush
      const flushLoop = async () => {
        while (this.running) {
          await new Promise((r) => setTimeout(r, chunkMs + 500));
          await this.flush();
        }
      };
      flushLoop();
    } catch {
      this.running = false;
    }
  }

  private async flush() {
    if (this.chunks.length === 0) return;
    const blob = new Blob(this.chunks.splice(0), { type: this.opts.mimeType ?? 'video/webm' });
    try {
      // direct upload preferred for large chunks
      await uploadDirect({
        token: this.opts.token,
        apiBaseUrl: this.opts.apiBaseUrl,
        blob,
        contentType: 'video/webm',
        testId: this.opts.testId,
        userId: this.opts.userId,
        contextExtras: { sequence: Date.now() },
      });
    } catch {
      try {
        await presignAndUpload({
          token: this.opts.token,
          apiBaseUrl: this.opts.apiBaseUrl,
          blob,
          contentType: 'video/webm',
          testId: this.opts.testId,
          userId: this.opts.userId,
          contextExtras: { sequence: Date.now() },
        });
      } catch {}
    }
  }

  stop() {
    this.running = false;
    this.recorder?.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
  }

  async destroy() { this.stop(); }
}
