import { ProctorEvent, SensorPlugin } from "../../core/types";
import { io, Socket } from "socket.io-client";

/**
 * ScreenShareSensor (Candidate)
 * Listens for admin_view_request via WebSocket; when received, prompts user for
 * screen capture, sets up WebRTC PeerConnection, sends offer and ICE to admin.
 *
 * Security: User gesture may be required for getDisplayMedia; only starts when requested.
 */
export class ScreenShareSensor implements SensorPlugin {
  private socket: Socket;
  private testId: string;
  private userId: string;
  private token: string;
  private pc?: RTCPeerConnection;
  private onViolation?: (evt: ProctorEvent) => void;

  constructor(opts: { wsUrl?: string; token: string; testId: string; userId: string; onViolation?: (evt: ProctorEvent) => void }) {
    this.testId = opts.testId;
    this.userId = opts.userId;
    this.token = opts.token;
    this.onViolation = opts.onViolation;
    this.socket = io(opts.wsUrl ?? window.location.origin, {
      path: "/socket.io",
      transports: ["websocket"],
      withCredentials: true,
      auth: { token: this.token },
    });
  }

  async init() {
    // handle admin stop globally
    this.socket.on("admin_stop", () => {
      this.pc?.getSenders().forEach((s) => s.track?.stop());
      this.pc?.close();
      this.pc = undefined;
      // Log admin forced stop as an event for audit
      this.onViolation?.({
        type: "admin_forced_stop",
        testId: this.testId,
        userId: this.userId,
        timestamp: new Date().toISOString(),
        details: { reason: "admin_stop" },
      });
    });

    // WebRTC admin->candidate relays
    this.socket.on("webrtc-answer", async (answer: any) => {
      if (!this.pc) return;
      try { await this.pc.setRemoteDescription(answer); } catch {}
    });
    this.socket.on("webrtc-ice-admin", async (candidate: any) => {
      try { await this.pc?.addIceCandidate(candidate); } catch {}
    });

    // start screen share on admin request
    this.socket.on("admin_view_request", async () => {
      try {
        // Close previous PC if exists
        if (this.pc) {
          this.pc.getSenders().forEach((s) => s.track?.stop());
          this.pc.close();
          this.pc = undefined;
        }
        const stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false });
        this.pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
        stream.getTracks().forEach((t: MediaStreamTrack) => this.pc!.addTrack(t, stream));
        this.pc.onicecandidate = (e) => {
          if (e.candidate) {
            this.socket.emit("webrtc-ice-candidate", { testId: this.testId, userId: this.userId, candidate: e.candidate });
          }
        };
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        this.socket.emit("webrtc-offer", { testId: this.testId, userId: this.userId, offer });
      } catch (e) {
        // user may cancel; ignore
      }
    });
  }

  start() { /* no-op; waits for admin request */ }
  stop() { /* no-op */ }
  destroy() { this.socket.close(); }
}
