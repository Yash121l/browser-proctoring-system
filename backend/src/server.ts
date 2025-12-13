/* eslint-disable no-console */
import express, { Request, Response, NextFunction } from "express";
import http from "http";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { Server as IOServer } from "socket.io";
import jwt from "jsonwebtoken";
import { router as presignRouter } from "./routes/presign";
import { quizRouter } from "./routes/quiz";
import { adminAttemptsRouter } from "./routes/adminAttempts";
import { userAuthRouter } from "./routes/userAuth";
import { prisma } from "./prisma";
import { Claims, ProctorEvent } from "./types";
import { S3Client, HeadBucketCommand, CreateBucketCommand } from "@aws-sdk/client-s3";

// ENV
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const S3_BUCKET = process.env.S3_BUCKET || "my-proctor-evidence";

// App + HTTP server
const app = express();
const server = http.createServer(app);

// Security headers (CSP tailored for dev; tighten for prod with nonce)
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "img-src": ["'self'", "blob:", "data:"],
        "connect-src": ["'self'", CORS_ORIGIN, "wss:", "ws:"],
        "worker-src": ["'self'", "blob:"],
        "media-src": ["'self'", "blob:"],
      },
    },
    hsts: process.env.NODE_ENV === "production" ? undefined : false,
  }),
);

// CORS
app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: true,
  }),
);

// Parsers
app.use(express.json({ limit: "512kb" }));

// Rate limiters
const publicLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(publicLimiter);

// Health
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Auth: /auth/login -> issues JWT for userId + testId
/**
 * POST /auth/login
 * Body: { userId: string, testId: string }
 * Returns: { token }
 * Security: Rate-limited; token short-lived (default 2h); do real auth in production.
 */
app.post("/auth/login", authLimiter, async (req: Request, res: Response) => {
  const { userId, testId } = req.body || {};
  if (!userId || !testId) return res.status(400).json({ error: "missing userId/testId" });

  const claims: Claims = { sub: userId, testId, role: "candidate" };
  const token = jwt.sign(claims, JWT_SECRET, { expiresIn: "2h" });
  return res.json({ token });
});

/**
 * POST /auth/adminLogin
 * Body: { adminId: string, secret: string }
 * Returns: { token }
 * Security: Requires ADMIN_SHARED_SECRET match. Use proper IdP in production.
 */
app.post("/auth/adminLogin", authLimiter, async (req: Request, res: Response) => {
  const { adminId, secret } = req.body || {};
  if (!adminId || !secret) return res.status(400).json({ error: "missing adminId/secret" });
  if (secret !== (process.env.ADMIN_SHARED_SECRET || "changeme")) {
    return res.status(401).json({ error: "invalid secret" });
  }
  const claims: Claims = { sub: adminId, testId: "*", role: "proctor" };
  const token = jwt.sign(claims, JWT_SECRET, { expiresIn: "2h" });
  return res.json({ token });
});

// Auth middleware for protected routes
function requireJWT(req: Request, res: Response, next: NextFunction) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : undefined;
  if (!token) return res.status(401).json({ error: "missing token" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as Claims;
    (req as any).claims = decoded;
    return next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
}

// Presign route (JWT required)
app.use("/presign", requireJWT, presignRouter);
app.use("/api", quizRouter);
app.use("/admin", adminAttemptsRouter);
app.use("/auth", userAuthRouter);

// HTTP fallback for event ingestion (optional; primary path is via WS)
app.post("/events", requireJWT, async (req: Request, res: Response) => {
  try {
    const claims = (req as any).claims as Claims;
    const evt = req.body as ProctorEvent;

    // Validate test/user match
    if (evt.userId !== claims.sub || evt.testId !== claims.testId) {
      return res.status(400).json({ error: "mismatched user/test in event" });
    }

    // Recompute clientHash deterministically
    const canonical = canonicalize(evt, ["clientHash", "_id"]);
    const clientHash = await sha256Hex(canonical);

    if (evt.clientHash && evt.clientHash !== clientHash) {
      return res.status(400).json({ error: "clientHash mismatch" });
    }

    // Compute server signature (HMAC style using JWT secret)
    const serverHash = await sha256Hex(clientHash + ":" + JWT_SECRET);

    const created = await prisma.proctorEvent.create({
      data: {
        testId: evt.testId,
        userId: evt.userId,
        type: evt.type,
        payload: evt as any,
        clientHash,
        serverHash,
        attemptId: (evt as any).attemptId ?? null,
      },
    });

    // Broadcast to admins joined to this session room
    const room = roomName(evt.testId, evt.userId);
    io.to(room).emit("event_broadcast", created);

    return res.json({ ok: true, id: created.id });
  } catch (e: any) {
    console.error("HTTP event ingest failed", e);
    return res.status(500).json({ error: "server_error" });
  }
});

// Socket.io with JWT auth
const io = new IOServer(server, {
  cors: { origin: CORS_ORIGIN, credentials: true },
  path: "/socket.io",
  transports: ["websocket"],
  maxHttpBufferSize: 1_000_000,
});

/**
 * Socket auth middleware
 * Expects handshake.auth.token with JWT.
 */
io.use((socket, next) => {
  const token = (socket.handshake.auth as any)?.token as string | undefined;
  if (!token) return next(new Error("missing token"));
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    // Normalize tokens that may have userId/adminId instead of sub
    const role: Claims["role"] = decoded.role || "candidate";
    let sub = decoded.sub ?? decoded.userId ?? decoded.adminId;
    if (!sub) {
      if (role === "proctor") sub = "admin"; // fallback label
      else return next(new Error("invalid token claims"));
    }
    const testId = decoded.testId ?? (role === "proctor" ? "*" : decoded.testId);
    const claims: Claims = { sub: String(sub), testId: String(testId || "*"), role };
    (socket as any).claims = claims;
    next();
  } catch (e) {
    next(new Error("invalid token"));
  }
});

// Basic per-socket message rate control
const socketCounters = new Map<string, { count: number; resetAt: number }>();
function allowed(socketId: string, maxPerMin = 120) {
  const now = Date.now();
  const entry = socketCounters.get(socketId) || { count: 0, resetAt: now + 60_000 };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + 60_000;
  }
  entry.count += 1;
  socketCounters.set(socketId, entry);
  return entry.count <= maxPerMin;
}

type SessionInfo = { testId: string; userId: string; socketId: string; connectedAt: number };
const sessions = new Map<string, SessionInfo>();
const roomName = (testId: string, userId: string) => `session:${testId}:${userId}`;

io.on("connection", (socket) => {
  const claims = (socket as any).claims as Claims;
  console.log("WS connected:", claims.role, claims.sub, "test:", claims.testId);

  if (claims.role === "candidate") {
    const room = roomName(claims.testId, claims.sub);
    socket.join(room);
    const key = `${claims.testId}:${claims.sub}`;
    sessions.set(key, { testId: claims.testId, userId: claims.sub, socketId: socket.id, connectedAt: Date.now() });
  }

  socket.on("heartbeat", () => {
    /* optional specific event */
  });

  socket.on("event", async (evt: ProctorEvent, ack?: (a: { ok: boolean; error?: string }) => void) => {
    if (!allowed(socket.id)) return ack?.({ ok: false, error: "rate_limited" });
    try {
      if (evt.userId !== claims.sub || evt.testId !== claims.testId) {
        return ack?.({ ok: false, error: "mismatched user/test" });
      }
      const canonical = canonicalize(evt, ["clientHash", "_id"]);
      const clientHash = await sha256Hex(canonical);
      if (evt.clientHash && evt.clientHash !== clientHash) {
        return ack?.({ ok: false, error: "clientHash mismatch" });
      }
      const serverHash = await sha256Hex(clientHash + ":" + JWT_SECRET);
      const created = await prisma.proctorEvent.create({
        data: {
          testId: evt.testId,
          userId: evt.userId,
          type: evt.type,
          payload: evt as any,
          clientHash,
          serverHash,
          attemptId: (evt as any).attemptId ?? null,
        },
      });
      // Broadcast to admins in this session room
      const room = roomName(evt.testId, evt.userId);
      io.to(room).emit("event_broadcast", created);
      ack?.({ ok: true });
    } catch (e: any) {
      console.error("WS event store failed", e);
      ack?.({ ok: false, error: "server_error" });
    }
  });

  // Admin joins a session room to observe events and handle WebRTC
  socket.on("admin_join_session", (data: { testId: string; userId: string }) => {
    const claims = (socket as any).claims as Claims;
    if (claims.role !== "proctor") return;
    const room = roomName(data.testId, data.userId);
    socket.join(room);
    prisma.adminAction.create({
      data: { adminId: claims.sub, action: "admin_join_session", testId: data.testId, userId: data.userId },
    }).catch(() => void 0);
  });

  // Admin requests a student to start screen share
  socket.on("admin_view_request", (data: { testId: string; userId: string }) => {
    const claims = (socket as any).claims as Claims;
    if (claims.role !== "proctor") return;
    const room = roomName(data.testId, data.userId);
    io.to(room).emit("admin_view_request", { by: claims.sub });
    prisma.adminAction.create({
      data: { adminId: claims.sub, action: "admin_view_request", testId: data.testId, userId: data.userId },
    }).catch(() => void 0);
  });

  // WebRTC signaling relay
  socket.on("webrtc-offer", (data: { testId: string; userId: string; offer: any }) => {
    const claims = (socket as any).claims as Claims;
    if (claims.role !== "candidate") return;
    const room = roomName(data.testId, data.userId);
    socket.to(room).emit("webrtc-offer", data.offer);
  });
  socket.on("webrtc-answer", (data: { testId: string; userId: string; answer: any }) => {
    const claims = (socket as any).claims as Claims;
    if (claims.role !== "proctor") return;
    const room = roomName(data.testId, data.userId);
    socket.to(room).emit("webrtc-answer", data.answer);
  });
  socket.on("webrtc-ice-candidate", (data: { testId: string; userId: string; candidate: any }) => {
    // Candidate -> Admin
    const claims = (socket as any).claims as Claims;
    if (claims.role !== "candidate") return;
    const room = roomName(data.testId, data.userId);
    socket.to(room).emit("webrtc-ice-candidate", data.candidate);
  });
  socket.on("webrtc-ice-admin", (data: { testId: string; userId: string; candidate: any }) => {
    // Admin -> Candidate
    const claims = (socket as any).claims as Claims;
    if (claims.role !== "proctor") return;
    const room = roomName(data.testId, data.userId);
    socket.to(room).emit("webrtc-ice-admin", data.candidate);
  });

  // Admin force stop
  socket.on("admin_stop", async (data: { testId: string; userId: string }) => {
    const claims = (socket as any).claims as Claims;
    if (claims.role !== "proctor") return;
    const room = roomName(data.testId, data.userId);
    io.to(room).emit("admin_stop", { by: claims.sub });
    // Log admin action
    await prisma.adminAction.create({
      data: { adminId: claims.sub, action: "admin_stop", testId: data.testId, userId: data.userId },
    });
  });

  socket.on("disconnect", (reason) => {
    const claims = (socket as any).claims as Claims;
    if (claims.role === "candidate") {
      const key = `${claims.testId}:${claims.sub}`;
      sessions.delete(key);
    }
    console.log("WS disconnected:", reason);
  });
});

// Utilities
function canonicalize(obj: any, omitKeys: string[] = []): string {
  const replacer = (_: string, value: any) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value)
          .sort()
          .reduce((acc, k) => {
            if (omitKeys.includes(k)) return acc;
            const v = value[k];
            if (v !== undefined) acc[k] = v;
            return acc;
          }, {} as any)
      : value;
  return JSON.stringify(obj, replacer);
}

async function sha256Hex(s: string): Promise<string> {
  const b = Buffer.from(s, "utf8");
  const crypto = await import("crypto");
  return crypto.createHash("sha256").update(b).digest("hex");
}

// Admin REST endpoints
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : undefined;
  if (!token) return res.status(401).json({ error: "missing token" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as Claims;
    if (decoded.role !== "proctor") return res.status(403).json({ error: "forbidden" });
    (req as any).claims = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
}

app.get("/admin/sessions", requireAdmin, (_req: Request, res: Response) => {
  res.json({ sessions: Array.from(sessions.values()) });
});

app.get("/admin/events", requireAdmin, async (req: Request, res: Response) => {
  const { testId, userId, limit = "100" } = req.query as any;
  if (!testId || !userId) return res.status(400).json({ error: "missing testId/userId" });
  const events = await prisma.proctorEvent.findMany({
    where: { testId: String(testId), userId: String(userId) },
    orderBy: { createdAt: "desc" },
    take: Number(limit),
  });
  res.json({ events });
});

// Start
server.listen(PORT, () => {
  console.log(`HTTP listening on :${PORT}`);
});

// Optional: best-effort ensure S3 bucket exists (logs helpful error if not)
(async () => {
  try {
    if (!S3_BUCKET) return;
    const s3 = new S3Client({ region: AWS_REGION });
    await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
  } catch (e: any) {
    console.error(`S3 bucket '${S3_BUCKET}' not found in region ${AWS_REGION}.`);
    try {
      const s3 = new S3Client({ region: AWS_REGION });
      if (AWS_REGION === "us-east-1") {
        await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
      } else {
        await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET, CreateBucketConfiguration: { LocationConstraint: AWS_REGION as any } }));
      }
      console.log(`Created S3 bucket '${S3_BUCKET}' in ${AWS_REGION}.`);
    } catch (err) {
      console.error(`Could not create S3 bucket '${S3_BUCKET}'. Set S3_BUCKET/AWS_REGION correctly and ensure permissions.`, err?.message || err);
    }
  }
})();
