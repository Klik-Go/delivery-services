import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const globalForPrisma = globalThis as unknown as { klikgoPrisma?: PrismaClient };

/**
 * Returns the process-wide Prisma client. Server-only: import it from the composition root
 * (apps/web/src/server/container.ts), never from components. It connects through the pooled
 * `DATABASE_URL` (Supavisor) with the pg driver adapter. Reusing one instance avoids exhausting
 * Supabase connections during Next.js hot reloads. The connection opens lazily on first query.
 */
export function getPrismaClient(): PrismaClient {
  globalForPrisma.klikgoPrisma ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
  return globalForPrisma.klikgoPrisma;
}
