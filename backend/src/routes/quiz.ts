import { Router, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../prisma";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
export const quizRouter = Router();

function requireUser(req: Request, res: Response, next: NextFunction) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : undefined;
  if (!token) return res.status(401).json({ error: "missing token" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    (req as any).user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (user?.role !== "admin") return res.status(403).json({ error: "forbidden" });
  next();
}

// Create quiz (admin)
quizRouter.post("/quizzes", requireUser, requireAdmin, async (req: Request, res: Response) => {
  const { title, description, proctorEnabled, proctorConfig, questions } = req.body || {};
  if (!title || !Array.isArray(questions)) return res.status(400).json({ error: "missing data" });
  const quiz = await prisma.quiz.create({
    data: {
      title,
      description,
      proctorEnabled: !!proctorEnabled,
      proctorConfig,
      createdById: Number((req as any).user.userId),
      questions: {
        create: questions.map((q: any, idx: number) => ({
          type: q.type,
          text: q.text,
          options: q.options ?? null,
          correctAnswer: q.correctAnswer ?? null,
          points: q.points ?? 1,
          order: idx,
        })),
      },
    },
    include: { questions: true },
  });
  res.json({ quiz });
});

// List quizzes (all)
quizRouter.get("/quizzes", requireUser, async (_req: Request, res: Response) => {
  const quizzes = await prisma.quiz.findMany({ include: { questions: true } });
  res.json({ quizzes });
});

// Start attempt (student)
quizRouter.post("/quizzes/:id/start", requireUser, async (req: Request, res: Response) => {
  const quizId = Number(req.params.id);
  const userId = Number((req as any).user.userId);
  const quiz = await prisma.quiz.findUnique({ where: { id: quizId } });
  if (!quiz) return res.status(404).json({ error: "not found" });
  const attempt = await prisma.quizAttempt.create({ data: { quizId, userId } });
  res.json({ attempt, proctor: { enabled: quiz.proctorEnabled, config: quiz.proctorConfig } });
});

// Submit attempt (student)
quizRouter.post("/attempts/:id/submit", requireUser, async (req: Request, res: Response) => {
  const attemptId = Number(req.params.id);
  const { answers } = req.body || {};
  const attempt = await prisma.quizAttempt.findUnique({ where: { id: attemptId }, include: { quiz: { include: { questions: true } } } });
  if (!attempt) return res.status(404).json({ error: "not found" });
  // naive scoring
  let score = 0;
  const answerCreates = [] as any[];
  for (const q of attempt.quiz.questions) {
    const a = answers?.[q.id];
    const correct = JSON.stringify(a) === JSON.stringify(q.correctAnswer);
    if (correct) score += q.points;
    answerCreates.push({ questionId: q.id, response: a ?? null, correct, pointsAwarded: correct ? q.points : 0 });
  }
  const updated = await prisma.quizAttempt.update({
    where: { id: attemptId },
    data: { status: "SUBMITTED", score, submittedAt: new Date(), answers: { create: answerCreates } },
  });
  res.json({ attempt: updated });
});

