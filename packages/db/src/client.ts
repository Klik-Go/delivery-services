import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { klikgoPrisma?: PrismaClient };

/**
 * Returns the process-wide Prisma client. Server-only: import it from the composition root
 * (apps/web/src/server/container.ts), never from components. Reusing one instance avoids
 * exhausting Supabase connections during Next.js hot reloads.
 */
export function getPrismaClient(): PrismaClient {
  globalForPrisma.klikgoPrisma ??= new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
  return globalForPrisma.klikgoPrisma;
}
