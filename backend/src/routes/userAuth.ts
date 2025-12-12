import { Router, Request, Response } from "express";
import { prisma } from "../prisma";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

export const userAuthRouter = Router();

/**
 * POST /auth/user/register
 * Body: { email, password, role: 'student'|'admin' }
 * Returns: { token, user }
 */
userAuthRouter.post("/user/register", async (req: Request, res: Response) => {
  const { email, password, role } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "missing email/password" });
  try {
    const hash = await bcrypt.hash(password, 10);
    // Map UI role -> token role expected by server sockets/routes
    const dbRole = role === "admin" ? "admin" : "student";
    const tokenRole = dbRole === "admin" ? "proctor" : "candidate";
    const user = await prisma.user.create({ data: { email, passwordHash: hash, role: dbRole as any } });
    const token = jwt.sign({ userId: user.id, role: tokenRole }, JWT_SECRET, { expiresIn: "8h" });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (e: any) {
    if (e?.code === "P2002") return res.status(409).json({ error: "email_exists" });
    return res.status(500).json({ error: "server_error" });
  }
});

/**
 * POST /auth/user/login
 * Body: { email, password }
 * Returns: { token, user }
 */
userAuthRouter.post("/user/login", async (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "missing email/password" });
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: "invalid_credentials" });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "invalid_credentials" });
  const tokenRole = user.role === "admin" ? "proctor" : "candidate";
  const token = jwt.sign({ userId: user.id, role: tokenRole }, JWT_SECRET, { expiresIn: "8h" });
  res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});
