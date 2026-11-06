import { AppError, err, ok, type IDatabaseProbe, type Result } from "@klikgo/core";
import type { PrismaClient } from "@klikgo/db";

/**
 * Reads the newest applied migration from Supabase's own migration history table
 * (supabase_migrations.schema_migrations, written by `supabase db push` / `db reset`).
 */
export class PrismaDatabaseProbe implements IDatabaseProbe {
  constructor(private readonly prisma: Pick<PrismaClient, "$queryRaw">) {}

  async schemaVersion(): Promise<Result<string | null, AppError>> {
    try {
      // Two queries on purpose: Postgres resolves every table name in a statement before running
      // it, so one query that only reads the table "if it exists" still fails on a database that
      // has never been migrated (no history table yet). That must read as "outdated", not
      // "unreachable".
      const table = await this.prisma.$queryRaw<{ present: boolean }[]>`
        select to_regclass('supabase_migrations.schema_migrations') is not null as present`;
      if (!table[0]?.present) return ok(null);
      const rows = await this.prisma.$queryRaw<{ version: string | null }[]>`
        select max(version) as version from supabase_migrations.schema_migrations`;
      return ok(rows[0]?.version ?? null);
    } catch (error) {
      // Connection refused, bad credentials, SSL, pool exhausted: the caller logs it with context.
      return err(
        new AppError("INTERNAL", error instanceof Error ? error.message : "Database error"),
      );
    }
  }
}
