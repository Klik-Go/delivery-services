import { getPrismaClient, LATEST_MIGRATION } from "@klikgo/db";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaDatabaseProbe } from "./prisma-database-probe";

const describeDb = describe.skipIf(!process.env.DATABASE_URL);

/** Thrown to roll the transaction back once the probe has answered. */
class Rollback extends Error {}

describeDb("PrismaDatabaseProbe (local Supabase)", () => {
  const prisma = getPrismaClient();
  afterAll(() => prisma.$disconnect());

  it("reports the newest applied migration, which a fresh db reset brings up to this build", async () => {
    expect(await new PrismaDatabaseProbe(prisma).schemaVersion()).toEqual({
      ok: true,
      value: LATEST_MIGRATION,
    });
  });

  it("reports no version (not an error) for a database that has never been migrated", async () => {
    // A brand-new hosted project has no supabase_migrations.schema_migrations until the first
    // `supabase db push`. Hide the table inside a transaction that is always rolled back.
    let answer: unknown;
    await prisma
      .$transaction(async (tx) => {
        await tx.$executeRaw`alter table supabase_migrations.schema_migrations rename to schema_migrations_hidden`;
        answer = await new PrismaDatabaseProbe(tx).schemaVersion();
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
    expect(answer).toEqual({ ok: true, value: null });
  });
});
