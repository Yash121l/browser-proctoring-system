export type ProctorEventType =
  | "heartbeat"
  | "fullscreen_violation"
  | "fullscreen_exit"
  | "tab_switch"
  | "tab_switch_limit_exceeded"
  | "no_face_detected"
  | "multiple_faces_detected"
  | "audio_noise"
  | "admin_forced_stop";

export interface ProctorEvent {
  testId: string;
  userId: string;
  attemptId?: number;
  type: ProctorEventType;
  timestamp: string;
  details: Record<string, any>;
  clientHash?: string;
  evidence?: { type: string; url: string; key: string };
  _id?: number; // offline store key
}

export interface ProctorConfig {
  testId: string;
  userId: string;
  attemptId?: number;
  checks: {
    forceFullScreen: boolean;
    tabSwitchDetection: boolean;
    cameraMonitoring: boolean;
    audioMonitoring: boolean;
    screenRecording: boolean;
    faceDetection: boolean;
    multipleFaceDetection: boolean;
    objectDetection: boolean;
  };
  thresholds: {
    maxTabSwitches?: number;
    noiseThreshold?: number;
    gazeToleranceSeconds?: number;
  };
  callbacks?: {
    onViolation?: string; // global path, e.g., window.onViolationHandler
    onForceSubmit?: string;
  };
  heartbeatIntervalMs?: number;
  frameCaptureIntervalMs?: number;

  // Optional endpoints; default to location.origin
  apiBaseUrl?: string;
  wsUrl?: string;
}

export interface SensorPlugin {
  init?(): Promise<void>;
  start?(): void;
  stop?(): void;
  destroy?(): Promise<void> | void;
}
