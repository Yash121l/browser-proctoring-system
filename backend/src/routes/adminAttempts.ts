import { Router, Request, Response } from "express";
import { prisma } from "../prisma";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
export const adminAttemptsRouter = Router();

function requireAdmin(req: Request, res: Response, next: Function) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : undefined;
  if (!token) return res.status(401).json({ error: "missing token" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (decoded.role !== "proctor") return res.status(403).json({ error: "forbidden" });
    (req as any).claims = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
}

// GET /admin/quiz/:id/attempts
adminAttemptsRouter.get("/quiz/:id/attempts", requireAdmin, async (req: Request, res: Response) => {
  const quizId = Number(req.params.id);
  const attempts = await prisma.quizAttempt.findMany({
    where: { quizId },
    include: { user: true },
    orderBy: { startedAt: "desc" },
  });
  // Summaries
  const summaries = await Promise.all(
    attempts.map(async (a) => {
      const events = await prisma.proctorEvent.findMany({ where: { attemptId: a.id }, orderBy: { createdAt: "desc" }, take: 1 });
      const last = events[0] || null;
      const counts = await prisma.proctorEvent.groupBy({ by: ["type"], where: { attemptId: a.id }, _count: { _all: true } }).catch(() => []);
      return {
        attemptId: a.id,
        userId: a.userId,
        userEmail: a.user.email,
        status: a.status,
        score: a.score,
        startedAt: a.startedAt,
        submittedAt: a.submittedAt,
        lastSnapshot: (last as any)?.payload?.evidence?.url ?? null,
        eventCounts: counts.reduce((acc: any, c: any) => { acc[c.type] = c._count?._all || 0; return acc; }, {}),
      };
    })
  );
  res.json({ attempts: summaries });
});

