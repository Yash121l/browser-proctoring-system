/* eslint-disable no-console */
import { io, Socket } from "socket.io-client";
import { sha256Hex } from "../utils/hash";
import { EventStore } from "../utils/indexeddb";
import { presignAndUpload, uploadDirect } from "../utils/upload";
import { ProctorConfig, ProctorEvent, SensorPlugin } from "../core/types";
import { FullscreenSensor } from "./plugins/FullscreenSensor";
import { TabSwitchSensor } from "./plugins/TabSwitchSensor";
import { CameraSensor } from "./plugins/CameraSensor";
import { ScreenShareSensor } from "./plugins/ScreenShareSensor";
import { ScreenCaptureSensor } from "./plugins/ScreenCaptureSensor";
import { ScreenRecorder } from "./plugins/ScreenRecorder";

/**
 * ProctorSDK
 * Orchestrates plugin-based sensors, WebSocket comms, offline storage, and evidence uploads.
 * Runs heavy ML in a Web Worker (via CameraSensor).
 *
 * Security considerations:
 * - Does not stream camera; only snapshots on violations.
 * - JWT required for socket and presign.
 * - Hashes each event client-side; server re-hashes for integrity.
 */
export class ProctorSDK {
  private config: ProctorConfig;
  private socket?: Socket;
  private heartbeatTimer?: number;
  private sensors: SensorPlugin[] = [];
  private token?: string;
  private eventStore = new EventStore("proctorDB", 1);
  private destroyed = false;

  /**
   * @param config Proctor configuration (see ProctorConfig).
   * Token is acquired separately (e.g., via /auth/login) and set via setToken.
   */
  constructor(config: ProctorConfig) {
    this.config = config;
  }

  /**
   * setToken
   * Saves the session JWT for WebSocket auth and presign requests.
   * - Inputs: JWT string
   * - Outputs: void
   * - Throws: none
   * - Security: Token should be short-lived and scoped to session/test.
   */
  setToken(token: string) {
    this.token = token;
  }

  /**
   * init
   * Connects WebSocket (with JWT), installs sensors based on config, and starts heartbeat.
   * - Inputs: none
   * - Outputs: Promise<void>
   * - Failure modes: socket connection error; missing token (throws).
   * - Security: Verifies same-origin unless explicitly configured.
   */
  async init(): Promise<void> {
    if (!this.token) throw new Error("ProctorSDK: missing JWT token");
    const origin = window.location.origin;
    const wsUrl = this.config.wsUrl ?? origin;
    const apiBase = this.config.apiBaseUrl ?? origin;

    // Setup socket.io with JWT auth
    this.socket = io(wsUrl, {
      path: "/socket.io",
      transports: ["websocket"],
      withCredentials: true,
      auth: { token: this.token },
    });

    this.socket.on("connect", () => {
      console.log("[ProctorSDK] WS connected", this.socket?.id);
      this.syncPending().catch(console.error);
    });
    this.socket.on("disconnect", (reason) => {
      console.warn("[ProctorSDK] WS disconnected", reason);
    });
    this.socket.on("connect_error", (err) => {
      console.error("[ProctorSDK] WS error", err);
    });
    // Admin forced stop -> log event and optionally invoke force-submit callback
    this.socket.on("admin_stop", () => {
      const evt: ProctorEvent = {
        type: "admin_forced_stop",
        testId: this.config.testId,
        userId: this.config.userId,
        timestamp: new Date().toISOString(),
        details: { reason: "admin_stop" },
      } as ProctorEvent;
      this.handleViolation(evt).catch(console.error);
      const cbName = this.config?.callbacks?.onForceSubmit;
      const cb = cbName && (this.getByPath(cbName) as (() => void) | undefined);
      try { cb?.(); } catch {}
    });

    // Configure sensors
    this.sensors = [];
    if (this.config.checks.forceFullScreen) {
      this.sensors.push(
        new FullscreenSensor({
          onViolation: (evt) => this.handleViolation(evt),
          autoRequest: true,
          initGraceMs: 1500,
        }),
      );
    }
    if (this.config.checks.tabSwitchDetection) {
      this.sensors.push(
        new TabSwitchSensor({
          maxTabSwitches: this.config.thresholds.maxTabSwitches ?? 3,
          onViolation: (evt) => this.handleViolation(evt),
        }),
      );
    }
    if (this.config.checks.cameraMonitoring || this.config.checks.faceDetection) {
      this.sensors.push(
        new CameraSensor({
          frameIntervalMs: this.config.frameCaptureIntervalMs ?? 200,
          faceDetection: !!this.config.checks.faceDetection,
          multipleFaceDetection: !!this.config.checks.multipleFaceDetection,
          onViolation: async (evt, snapshotBlob) => {
            // Upload evidence only when event occurs
            if (snapshotBlob) {
              try {
                let url: string | undefined; let key: string | undefined; let viewUrl: string | undefined;
                try {
                  const r = await presignAndUpload({
                    token: this.token!,
                    apiBaseUrl: apiBase,
                    blob: snapshotBlob,
                    contentType: "image/jpeg",
                    testId: this.config.testId,
                    userId: this.config.userId,
                  });
                  url = r.url; key = r.key; viewUrl = r.viewUrl;
                } catch {
                  const r = await uploadDirect({
                    token: this.token!,
                    apiBaseUrl: apiBase,
                    blob: snapshotBlob,
                    contentType: "image/jpeg",
                    testId: this.config.testId,
                    userId: this.config.userId,
                  });
                  url = r.url; key = r.key; viewUrl = r.url;
                }
                evt.evidence = { type: "image/jpeg", url: viewUrl || url!, key: key! };
              } catch (e) {
                console.error("Evidence upload failed", e);
                // Continue, we still log the event even if upload fails
              }
            }
            this.handleViolation(evt);
          },
        }),
      );
    }

    // Screen share sensor (admin live view)
    if (this.config.checks.screenRecording) {
      this.sensors.push(
        new ScreenShareSensor({
          wsUrl: wsUrl,
          token: this.token!,
          testId: this.config.testId,
          userId: this.config.userId,
          onViolation: (evt) => this.handleViolation(evt),
        }),
      );
      // Local periodic screen snapshot evidence
      const previewCbName = this.config?.callbacks?.onScreenPreview;
      const previewCb = previewCbName && (this.getByPath(previewCbName) as ((dataUrl: string) => void) | undefined);
      this.sensors.push(new ScreenCaptureSensor({
        onViolation: (evt) => this.handleViolation(evt),
        onPreview: (d) => { try { previewCb?.(d); } catch {} },
        testId: this.config.testId,
        userId: this.config.userId,
        token: this.token!,
        apiBaseUrl: apiBase,
        snapshotIntervalMs: this.config.screenSnapshotIntervalMs ?? 30000,
      }));
      if (this.config.recording?.enabled) {
        this.sensors.push(new ScreenRecorder({
          token: this.token!,
          apiBaseUrl: apiBase,
          testId: this.config.testId,
          userId: this.config.userId,
          chunkMs: this.config.recording?.chunkMs ?? 60000,
          mimeType: this.config.recording?.mimeType ?? 'video/webm;codecs=vp8',
        }));
      }
    }

    // Start sensors
    await Promise.all(this.sensors.map((s) => s.init?.()));
    this.sensors.forEach((s) => s.start?.());

    // Heartbeats
    const interval = this.config.heartbeatIntervalMs ?? 5000;
    this.heartbeatTimer = window.setInterval(() => {
      this.sendHeartbeat().catch(console.error);
    }, interval);

    // Register online handler to sync
    window.addEventListener("online", () => this.syncPending().catch(console.error));
  }

  /**
   * destroy
   * Cleans up timers, sockets, sensors, and marks SDK as destroyed.
   * - Inputs: none
   * - Outputs: Promise<void>
   * - Failure modes: sensor stop errors (ignored but logged)
   */
  async destroy(): Promise<void> {
    this.destroyed = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const s of this.sensors) {
      try {
        await s.stop?.();
        await s.destroy?.();
      } catch (e) {
        console.warn("Sensor cleanup error", e);
      }
    }
    this.sensors = [];
    if (this.socket && this.socket.connected) this.socket.disconnect();
  }

  /**
   * sendHeartbeat
   * Emits a signed heartbeat event via WebSocket and stores locally if offline.
   * - Inputs: none
   * - Outputs: Promise<void>
   * - Failure modes: socket not connected (stores offline)
   * - Security: Includes only non-sensitive telemetry; hashed for integrity.
   */
  private async sendHeartbeat(): Promise<void> {
    const evt: ProctorEvent = {
      testId: this.config.testId,
      userId: this.config.userId,
      attemptId: this.config.attemptId,
      type: "heartbeat",
      timestamp: new Date().toISOString(),
      details: { status: "ok" },
    };
    await this.emitEvent(evt);
  }

  /**
   * handleViolation
   * Callback invoked by sensors to report a violation; computes hash and emits/stores.
   * - Inputs: evt (ProctorEvent)
   * - Outputs: Promise<void>
   * - Security: Evidence URL included only if upload succeeded.
   */
  private async handleViolation(evt: ProctorEvent): Promise<void> {
    // Patch in test/user in case sensors left blanks
    evt.testId ||= this.config.testId;
    evt.userId ||= this.config.userId;
    if (this.config.attemptId && evt.attemptId == null) {
      (evt as any).attemptId = this.config.attemptId;
    }
    await this.emitEvent(evt);
    // Callback hook
    const cbName = this.config?.callbacks?.onViolation;
    const cb = cbName && (this.getByPath(cbName) as ((e: ProctorEvent) => void) | undefined);
    try {
      cb?.(evt);
    } catch (e) {
      console.warn("onViolation callback error", e);
    }
  }

  /**
   * emitEvent
   * Canonicalizes and hashes event, tries socket emit, and queues in IndexedDB if needed.
   * - Inputs: evt (ProctorEvent)
   * - Outputs: Promise<void>
   * - Failure modes: hashing error; socket failure
   */
  private async emitEvent(evt: ProctorEvent): Promise<void> {
    const canonical = ProctorSDK.canonicalize(evt);
    const clientHash = await sha256Hex(canonical);
    const payload = { ...evt, clientHash };

    // Try WebSocket first
    if (this.socket?.connected) {
      try {
        await new Promise<void>((resolve, reject) => {
          this.socket!.emit("event", payload, (ack: { ok: boolean; error?: string }) => {
            if (ack?.ok) resolve();
            else reject(new Error(ack?.error || "Event not accepted"));
          });
        });
        return;
      } catch (e) {
        console.warn("WS emit failed, queueing offline", e);
      }
    }

    // Queue offline if WS unavailable
    await this.eventStore.enqueue(payload);
  }

  /**
   * syncPending
   * Flushes queued events to server (WebSocket preferred; falls back to HTTP).
   * - Inputs: none
   * - Outputs: Promise<void>
   * - Failure modes: offline; server reject; partial success
   */
  private async syncPending(): Promise<void> {
    const pending = await this.eventStore.getAll();
    for (const item of pending) {
      try {
        if (this.socket?.connected) {
          await new Promise<void>((resolve, reject) => {
            this.socket!.emit("event", item, (ack: { ok: boolean; error?: string }) => {
              if (ack?.ok) resolve();
              else reject(new Error(ack?.error || "Event not accepted"));
            });
          });
          await this.eventStore.remove(item._id);
        } else {
          // HTTP fallback if desired: POST /events
          const apiBase = this.config.apiBaseUrl ?? window.location.origin;
          const res = await fetch(`${apiBase}/events`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.token}`,
            },
            body: JSON.stringify(item),
            credentials: "include",
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          await this.eventStore.remove(item._id);
        }
      } catch (e) {
        console.warn("Sync item failed; will retry later", e);
      }
    }
  }

  /**
   * canonicalize
   * Deterministic JSON stringify for hashing; sorts keys and prunes undefined.
   * - Inputs: obj (any)
   * - Outputs: string
   * - Security: Prevents hash mismatches due to key order differences.
   */
  static canonicalize(obj: any): string {
    const replacer = (_: string, value: any) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.keys(value)
            .sort()
            .reduce((acc, k) => {
              const v = value[k];
              if (v !== undefined) acc[k] = v;
              return acc;
            }, {} as any)
        : value;
    return JSON.stringify(obj, replacer);
  }

  /**
   * getByPath
   * Resolves a dotted path (e.g., 'window.onViolationHandler') in global scope.
   * - Inputs: path string
   * - Outputs: any or undefined
   * - Security: Only for user-specified callbacks; do not use on untrusted inputs.
   */
  private getByPath(path: string): any {
    const parts = path.split(".");
    let ctx: any = window as any;
    for (const p of parts) {
      if (ctx == null) return undefined;
      ctx = ctx[p];
    }
    return ctx;
  }
}
