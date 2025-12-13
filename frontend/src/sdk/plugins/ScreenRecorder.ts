import { SensorPlugin } from "../../core/types";
import { uploadDirect, presignAndUpload } from "../../utils/upload";

export class ScreenRecorder implements SensorPlugin {
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private running = false;
  private seq = 0;
  private manifest: { chunks: { key?: string; url?: string; ts: number; seq: number; source: 'screen'|'camera' }[] } = { chunks: [] };

  constructor(private opts: { token: string; apiBaseUrl: string; testId: string; userId: string; chunkMs?: number; mimeType?: string; source?: 'screen'|'camera' }) {}

  async init() {
    // Lazy permission; recorder starts on start()
  }

  async start() {
    if (this.running) return;
    this.running = true;
    try {
      if (this.opts.source === 'camera') {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { frameRate: 12 }, audio: false });
      } else {
        this.stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: { frameRate: 12 }, audio: false });
      }
      const mime = this.opts.mimeType ?? 'video/webm;codecs=vp8';
      this.recorder = new MediaRecorder(this.stream, { mimeType: mime } as any);
      this.recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) this.chunks.push(e.data); };
      this.recorder.onstop = () => this.flush();
      const chunkMs = Math.max(5000, this.opts.chunkMs ?? 60000);
      this.recorder.start(chunkMs);
      try { (window as any).onRecordingStatus?.({ source: this.opts.source || 'screen', active: true }); } catch {}
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
      this.seq += 1;
      const uploaded = await uploadDirect({
        token: this.opts.token,
        apiBaseUrl: this.opts.apiBaseUrl,
        blob,
        contentType: 'video/webm',
        testId: this.opts.testId,
        userId: this.opts.userId,
        contextExtras: { sequence: this.seq, source: this.opts.source || 'screen' },
      });
      this.manifest.chunks.push({ key: uploaded.key, url: uploaded.url, ts: Date.now(), seq: this.seq, source: (this.opts.source || 'screen') as any });
      // Upload/overwrite manifest JSON (direct avoids CORS)
      const manifestBlob = new Blob([JSON.stringify(this.manifest)], { type: 'application/json' });
      await uploadDirect({
        token: this.opts.token,
        apiBaseUrl: this.opts.apiBaseUrl,
        blob: manifestBlob,
        contentType: 'application/json',
        testId: this.opts.testId,
        userId: this.opts.userId,
        contextExtras: { name: `manifest.${this.opts.source || 'screen'}.json` },
      }).catch(() => {});
    } catch {
      try {
        this.seq += 1;
        const up2 = await presignAndUpload({
          token: this.opts.token,
          apiBaseUrl: this.opts.apiBaseUrl,
          blob,
          contentType: 'video/webm',
          testId: this.opts.testId,
          userId: this.opts.userId,
          contextExtras: { sequence: this.seq, source: this.opts.source || 'screen' },
        });
        this.manifest.chunks.push({ key: up2.key, url: up2.url, ts: Date.now(), seq: this.seq, source: (this.opts.source || 'screen') as any });
        const manifestBlob = new Blob([JSON.stringify(this.manifest)], { type: 'application/json' });
        await presignAndUpload({
          token: this.opts.token,
          apiBaseUrl: this.opts.apiBaseUrl,
          blob: manifestBlob,
          contentType: 'application/json',
          testId: this.opts.testId,
          userId: this.opts.userId,
          contextExtras: { name: `manifest.${this.opts.source || 'screen'}.json` },
        }).catch(() => {});
      } catch {}
    }
  }

  stop() {
    this.running = false;
    this.recorder?.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    try { (window as any).onRecordingStatus?.({ source: this.opts.source || 'screen', active: false }); } catch {}
  }

  async destroy() { this.stop(); }
}
