import { PrismaClient } from "@prisma/client";

/**
 * Prisma client singleton.
 * Security: Use least-privilege DB user; TLS via DATABASE_URL settings if needed.
 */
export const prisma = new PrismaClient();

