import { getPrismaClient, LATEST_MIGRATION } from "@klikgo/db";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaDatabaseProbe } from "./prisma-database-probe";

const describeDb = describe.skipIf(!process.env.DATABASE_URL);

describeDb("PrismaDatabaseProbe (local Supabase)", () => {
  const prisma = getPrismaClient();
  afterAll(() => prisma.$disconnect());

  it("reports the newest applied migration, which a fresh db reset brings up to this build", async () => {
    expect(await new PrismaDatabaseProbe(prisma).schemaVersion()).toEqual({
      ok: true,
      value: LATEST_MIGRATION,
    });
  });
});
