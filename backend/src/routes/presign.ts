import { Router, Request, Response } from "express";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import jwt from "jsonwebtoken";
import { Claims } from "../types";

export const router = Router();

const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const S3_BUCKET = process.env.S3_BUCKET || "my-proctor-evidence";
const PRESIGN_TTL_SECONDS = Number(process.env.PRESIGN_TTL_SECONDS || 120);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

const s3 = new S3Client({ region: AWS_REGION });

/**
 * POST /presign
 * Body: { contentType: string, context: { testId: string, userId: string, kind: "evidence" } }
 * Auth: Bearer JWT
 * Returns: { url, key }
 * Security:
 *  - Validates origin (strict in production)
 *  - Restricts key prefix to evidence/<testId>/<userId>/timestamp.jpg
 *  - TTL short (default 120s)
 *  - Only allows image/jpeg for snapshot evidence
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    // Origin validation
    const origin = req.headers.origin;
    if (origin && origin !== CORS_ORIGIN) {
      return res.status(403).json({ error: "origin_not_allowed" });
    }

    // JWT claims already loaded by middleware in server.ts; fallback verify here
    const hdr = req.headers.authorization || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : undefined;
    if (!token) return res.status(401).json({ error: "missing token" });

    const claims = jwt.verify(token, JWT_SECRET) as Claims;

    const { contentType, context } = req.body || {};
    if (!contentType || !context?.testId || !context?.userId) {
      return res.status(400).json({ error: "missing contentType/context" });
    }
    if (context.testId !== claims.testId || context.userId !== claims.sub) {
      return res.status(400).json({ error: "context does not match token" });
    }
    if (contentType !== "image/jpeg") {
      return res.status(400).json({ error: "unsupported contentType" });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const key = `evidence/${context.testId}/${context.userId}/${timestamp}.jpg`;

    const cmd = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const url = await getSignedUrl(s3, cmd, { expiresIn: PRESIGN_TTL_SECONDS });
    return res.json({ url, key });
  } catch (e: any) {
    console.error("presign error", e);
    return res.status(500).json({ error: "server_error" });
  }
});

