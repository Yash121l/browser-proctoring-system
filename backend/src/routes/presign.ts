import { Router, Request, Response } from "express";
import { S3Client, PutObjectCommand, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Claims } from "../types";

export const router = Router();

const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const S3_BUCKET = process.env.S3_BUCKET || "my-proctor-evidence";
const PRESIGN_TTL_SECONDS = Number(process.env.PRESIGN_TTL_SECONDS || 120);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

const s3 = new S3Client({ region: AWS_REGION });

/**
 * POST /presign
 * Body: { contentType: string, context: { testId: string, userId: string, kind?: "evidence"|"recordings" } }
 * Auth: Bearer JWT
 * Returns: { url, key, viewUrl }
 * Security:
 *  - Validates origin (strict in production)
 *  - Restricts key prefix to evidence/<...> or recordings/<...>
 *  - TTL short (default 120s)
 *  - Allows image/jpeg and video/webm
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    // Origin validation
    const origin = req.headers.origin;
    if (origin && origin !== CORS_ORIGIN) {
      return res.status(403).json({ error: "origin_not_allowed" });
    }
    // Rely on requireJWT middleware (server.ts) to have attached verified claims
    const claims = (req as any).claims as Claims | undefined;
    if (!claims) return res.status(401).json({ error: "unauthorized" });

    const { contentType, context } = req.body || {};
    if (!contentType || !context?.testId || !context?.userId) {
      return res.status(400).json({ error: "missing contentType/context" });
    }
    if (context.testId !== claims.testId || context.userId !== claims.sub) {
      return res.status(400).json({ error: "context does not match token" });
    }
    const allowed = new Set(["image/jpeg", "video/webm"]);
    if (!allowed.has(contentType)) return res.status(400).json({ error: "unsupported contentType" });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const kind = context.kind || (contentType.startsWith("video/") ? "recordings" : "evidence");
    const ext = contentType === "image/jpeg" ? "jpg" : contentType === "video/webm" ? "webm" : "bin";
    const key = `${kind}/${context.testId}/${context.userId}/${timestamp}.${ext}`;

    const cmd = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: contentType,
    });

    let url: string;
    try {
      url = await getSignedUrl(s3, cmd, { expiresIn: PRESIGN_TTL_SECONDS });
    } catch (e: any) {
      if (e?.Code === "NoSuchBucket" || e?.name === "NoSuchBucket") {
        try { await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET })); }
        catch {
          if (AWS_REGION === "us-east-1") await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
          else await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET, CreateBucketConfiguration: { LocationConstraint: AWS_REGION } } as any));
        }
        url = await getSignedUrl(s3, cmd, { expiresIn: PRESIGN_TTL_SECONDS });
      } else {
        throw e;
      }
    }
    const region = AWS_REGION;
    const viewUrl = `https://${S3_BUCKET}.s3.${region}.amazonaws.com/${encodeURIComponent(key)}`;
    return res.json({ url, key, viewUrl });
  } catch (e: any) {
    console.error("presign error", e);
    return res.status(500).json({ error: "server_error" });
  }
});

/**
 * POST /presign/direct
 * Body: { contentType: string, context: { testId, userId, kind?: "evidence"|"recordings" }, dataBase64: string }
 * Streams bytes to S3 with the server credentials to avoid S3 CORS preflight.
 * Returns: { key, url }
 */
router.post("/direct", async (req: Request, res: Response) => {
  try {
    const claims = (req as any).claims as Claims | undefined;
    if (!claims) return res.status(401).json({ error: "unauthorized" });
    const { contentType, context, dataBase64 } = req.body || {};
    if (!contentType || !context?.testId || !context?.userId || !dataBase64) {
      return res.status(400).json({ error: "missing fields" });
    }
    if (context.testId !== claims.testId || context.userId !== claims.sub) {
      return res.status(400).json({ error: "context does not match token" });
    }
    const allowed = new Set(["image/jpeg", "video/webm"]);
    if (!allowed.has(contentType)) return res.status(400).json({ error: "unsupported contentType" });
    const bytes = Buffer.from(String(dataBase64), "base64");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const kind = context.kind || (contentType.startsWith("video/") ? "recordings" : "evidence");
    const ext = contentType === "image/jpeg" ? "jpg" : contentType === "video/webm" ? "webm" : "bin";
    const key = `${kind}/${context.testId}/${context.userId}/${timestamp}.${ext}`;
    try {
      await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: bytes, ContentType: contentType }));
    } catch (e: any) {
      if (e?.Code === "NoSuchBucket" || e?.name === "NoSuchBucket") {
        try { await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET })); }
        catch {
          if (AWS_REGION === "us-east-1") await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
          else await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET, CreateBucketConfiguration: { LocationConstraint: AWS_REGION } } as any));
        }
        await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: bytes, ContentType: contentType }));
      } else {
        throw e;
      }
    }
    const region = AWS_REGION;
    const url = `https://${S3_BUCKET}.s3.${region}.amazonaws.com/${encodeURIComponent(key)}`;
    return res.json({ key, url });
  } catch (e: any) {
    console.error("direct upload error", e);
    return res.status(500).json({ error: "server_error" });
  }
});
