import { beforeEach, expect, it } from "vitest";
import { describeDb, failureOf, useRollbackTransaction } from "./support";

const CENTRE = { lat: 14.5547, lng: 121.0244 };

/** Phase 12: invite codes with the first-100 cap, and rider online time. */
describeDb("pilot launch: invites and rider shifts", () => {
  const { db, fx } = useRollbackTransaction();
  let zone: string;

  beforeEach(async () => {
    zone = await fx().zone({ name: "Pilot Zone", centre: CENTRE });
  });

  const invite = (code: string, extra = "") =>
    db().query(
      `insert into public.pilot_invites (code, batch${extra ? ", expires_at" : ""})
                values ($1, 'test'${extra ? `, ${extra}` : ""})`,
      [code],
    );
  const redeem = async (code: string, user: string, max = 100): Promise<string> =>
    (
      await db().query<{ result: string }>("select private.redeem_invite($1, $2, $3) as result", [
        code,
        user,
        max,
      ])
    ).rows[0]?.result ?? "";

  it("redeems a code once per code and once per person, case-insensitively", async () => {
    const ana = await fx().user("Ana Invite");
    const ben = await fx().user("Ben Invite");
    await invite("PILOT001");
    await invite("PILOT002");
    expect(await redeem(" pilot001 ", ana)).toBe("ok");
    expect(await redeem("PILOT001", ben)).toBe("used");
    expect(await redeem("PILOT002", ana)).toBe("already");
    expect(await redeem("NOPE0000", ben)).toBe("invalid");
    expect(await redeem("PILOT002", ben)).toBe("ok");
  });

  it("refuses expired codes and stops at the customer cap", async () => {
    const [a, b, c] = [await fx().user("A"), await fx().user("B"), await fx().user("C")];
    await invite("OLDCODE1", "now() - interval '1 day'");
    expect(await redeem("OLDCODE1", a)).toBe("expired");
    const before =
      (
        await db().query<{ n: number }>(
          "select count(*)::int as n from public.pilot_invites where redeemed_by is not null",
        )
      ).rows[0]?.n ?? 0;
    await invite("CAPCODE1");
    await invite("CAPCODE2");
    expect(await redeem("CAPCODE1", b, before + 1)).toBe("ok");
    expect(await redeem("CAPCODE2", c, before + 1)).toBe("full");
  });

  it("keeps codes in the documented shape and redemption fields together", async () => {
    expect(await failureOf(db(), () => invite("bad code"))).toMatch(/pilot_invites_code_check/);
    expect(
      await failureOf(db(), () =>
        db().query(
          `insert into public.pilot_invites (code, batch, redeemed_at) values ('HALFDONE', 'x', now())`,
        ),
      ),
    ).toMatch(/pilot_invites_redeemed_together/);
  });

  it("opens a shift when a rider goes online and closes it when they go offline", async () => {
    const user = await fx().user("Sid Shift");
    const rider = await fx().rider({ userId: user, zoneId: zone, isOnline: true });
    const shifts = () =>
      db().query<{ open: boolean }>(
        "select ended_at is null as open from public.rider_shifts where rider_id = $1 order by id",
        [rider],
      );
    expect((await shifts()).rows).toEqual([{ open: true }]);
    await db().query("update public.riders set is_online = true where id = $1", [rider]);
    expect((await shifts()).rows).toHaveLength(1);
    await db().query("update public.riders set is_online = false where id = $1", [rider]);
    expect((await shifts()).rows).toEqual([{ open: false }]);
    await db().query("update public.riders set is_online = true where id = $1", [rider]);
    expect((await shifts()).rows).toEqual([{ open: false }, { open: true }]);
  });

  it("seeds the pilot switches off, with the documented settings", async () => {
    const { rows } = await db().query<{ key: string; enabled: boolean; rollout: unknown }>(
      `select key, enabled, rollout from public.feature_flags
        where key in ('invite_only', 'pilot_scope', 'scheduled_orders') order by key`,
    );
    expect(rows).toEqual([
      { key: "invite_only", enabled: false, rollout: { max_customers: 100 } },
      { key: "pilot_scope", enabled: false, rollout: { categories: ["food"] } },
      { key: "scheduled_orders", enabled: true, rollout: {} },
    ]);
  });
});
