import { AppError, err, ok, type IDatabaseProbe, type Result } from "@klikgo/core";
import type { PrismaClient } from "@klikgo/db";

/**
 * Reads the newest applied migration from Supabase's own migration history table
 * (supabase_migrations.schema_migrations, written by `supabase db push` / `db reset`).
 */
export class PrismaDatabaseProbe implements IDatabaseProbe {
  constructor(private readonly prisma: PrismaClient) {}

  async schemaVersion(): Promise<Result<string | null, AppError>> {
    try {
      const rows = await this.prisma.$queryRaw<{ version: string | null }[]>`
        select case when to_regclass('supabase_migrations.schema_migrations') is null then null
                    else (select max(version) from supabase_migrations.schema_migrations) end as version`;
      return ok(rows[0]?.version ?? null);
    } catch (error) {
      // Connection refused, bad credentials, SSL, pool exhausted: the caller logs it with context.
      return err(
        new AppError("INTERNAL", error instanceof Error ? error.message : "Database error"),
      );
    }
  }
}
