import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { asUser } from "../src/testing";
import { describeDb, failureOf, useRollbackTransaction } from "./support";

describeDb("rate limiting in Postgres (private.hit_rate_limit)", () => {
  const { db, fx } = useRollbackTransaction();

  async function hit(key: string, limit = 5, windowSeconds = 3600) {
    const { rows } = await db().query<{
      allowed: boolean;
      remaining: number;
      retry_after_seconds: number;
    }>(`select * from private.hit_rate_limit($1, $2, $3)`, [key, limit, windowSeconds]);
    return rows[0];
  }

  it("allows up to the limit in a window, then refuses with a retry time", async () => {
    const key = `test:${randomUUID()}`;
    for (let i = 1; i <= 5; i += 1) {
      expect(await hit(key)).toEqual({ allowed: true, remaining: 5 - i, retry_after_seconds: 0 });
    }
    const sixth = await hit(key);
    expect(sixth?.allowed).toBe(false);
    expect(sixth?.remaining).toBe(0);
    expect(sixth?.retry_after_seconds).toBeGreaterThan(0);
    expect(sixth?.retry_after_seconds).toBeLessThanOrEqual(3600);
  });

  it("counts each key separately", async () => {
    const a = `test:${randomUUID()}`;
    const b = `test:${randomUUID()}`;
    await hit(a, 1);
    expect((await hit(a, 1))?.allowed).toBe(false);
    expect((await hit(b, 1))?.allowed).toBe(true);
  });

  it("cannot be called or read by API roles (server only)", async () => {
    const user = await fx().user("Curious Customer");
    for (const who of [user, null]) {
      const call = await asUser(db(), who, () =>
        failureOf(db(), () => db().query(`select * from private.hit_rate_limit('x', 1, 60)`)),
      );
      expect(call).toMatch(/permission denied/);
      const read = await asUser(db(), who, () =>
        failureOf(db(), () => db().query(`select * from private.rate_limit_counters`)),
      );
      expect(read).toMatch(/permission denied/);
    }
  });

  it("cleans old windows up every hour with pg_cron", async () => {
    const { rows } = await db().query<{ schedule: string }>(
      `select schedule from cron.job where jobname = 'klikgo-rate-limit-cleanup'`,
    );
    expect(rows).toEqual([{ schedule: "17 * * * *" }]);
  });
});
