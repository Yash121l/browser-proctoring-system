export interface Claims {
  sub: string;      // userId
  testId: string;
  role: "candidate" | "proctor" | "system";
  iat?: number;
  exp?: number;
}

export type ProctorEventType =
  | "heartbeat"
  | "fullscreen_violation"
  | "fullscreen_exit"
  | "tab_switch"
  | "tab_switch_limit_exceeded"
  | "no_face_detected"
  | "multiple_faces_detected"
  | "audio_noise";

export interface ProctorEvent {
  testId: string;
  userId: string;
  type: ProctorEventType;
  timestamp: string;
  details: Record<string, any>;
  clientHash?: string;
  evidence?: { type: string; url: string; key: string };
  _id?: number;
}

