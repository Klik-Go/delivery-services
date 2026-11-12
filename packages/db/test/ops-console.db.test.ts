import { beforeEach, expect, it } from "vitest";
import { describeDb, failureOf, useRollbackTransaction } from "./support";

const CENTRE = { lat: 14.5547, lng: 121.0244 };

/** Phase 8: zone topics for the live console, scheduled commission, rider payout document. */
describeDb("ops console: zone topics, commission schedule, rider onboarding", () => {
  const { db, fx } = useRollbackTransaction();
  let zone: string;
  let otherZone: string;
  let merchant: string;
  let coordinator: string;
  let otherCoordinator: string;
  let admin: string;

  beforeEach(async () => {
    zone = await fx().zone({ name: "Ops Zone", centre: CENTRE });
    otherZone = await fx().zone({ name: "Other Zone", centre: { lat: 15.03, lng: 120.68 } });
    coordinator = await fx().user("Ops Coordinator", [{ role: "coordinator", zoneId: zone }]);
    otherCoordinator = await fx().user("Other Coordinator", [
      { role: "coordinator", zoneId: otherZone },
    ]);
    admin = await fx().user("Ops Admin", [{ role: "admin" }]);
    const owner = await fx().user("Ops Owner");
    merchant = await fx().merchant({
      zoneId: zone,
      ownerId: owner,
      name: "Ops Store",
      location: CENTRE,
    });
  });

  async function follows(userId: string, topic: string, aal: "aal1" | "aal2"): Promise<boolean> {
    await db().query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated", aal }),
    ]);
    await db().query("set local role authenticated");
    try {
      const { rows } = await db().query<{ ok: boolean }>(
        "select private.can_follow_topic($1) as ok",
        [topic],
      );
      return rows[0]?.ok ?? false;
    } finally {
      await db().query("reset role");
    }
  }

  it("lets a zone's coordinator (with TOTP) and admins follow the zone's live topic, nobody else", async () => {
    expect(await follows(coordinator, `zone:${zone}`, "aal2")).toBe(true);
    expect(await follows(coordinator, `zone:${zone}`, "aal1")).toBe(false);
    expect(await follows(otherCoordinator, `zone:${zone}`, "aal2")).toBe(false);
    expect(await follows(admin, `zone:${otherZone}`, "aal2")).toBe(true);
    expect(await follows(coordinator, "zone:not-a-uuid", "aal2")).toBe(false);
  });

  it("applies a scheduled commission only from its date", async () => {
    await db().query(
      `update public.merchants set commission_bps = 2000, next_commission_bps = 1500,
              next_commission_from = now() + interval '1 day' where id = $1`,
      [merchant],
    );
    const at = async (when: string): Promise<number | undefined> => {
      const { rows } = await db().query<{ bps: number }>(
        `select private.commission_bps($1, now() + $2::interval) as bps`,
        [merchant, when],
      );
      return rows[0]?.bps;
    };
    expect(await at("0 hours")).toBe(2000);
    expect(await at("25 hours")).toBe(1500);
  });

  it("keeps the scheduled commission and its date together, and within 0–50%", async () => {
    const lonely = await failureOf(db(), () =>
      db().query("update public.merchants set next_commission_bps = 1500 where id = $1", [
        merchant,
      ]),
    );
    expect(lonely).toMatch(/merchants_next_commission_pair/);
    const tooHigh = await failureOf(db(), () =>
      db().query(
        "update public.merchants set next_commission_bps = 9000, next_commission_from = now() where id = $1",
        [merchant],
      ),
    );
    expect(tooHigh).toMatch(/next_commission_bps/);
  });

  it("accepts the payout account as a rider document, and keeps notes non-empty", async () => {
    const { rows } = await db().query<{ value: string }>(
      "select unnest(enum_range(null::public.kyc_document_type))::text as value",
    );
    expect(rows.map((r) => r.value)).toContain("payout_account");
    const customer = await fx().user("Ops Customer");
    const { rows: order } = await db().query<{ id: string }>(
      `insert into public.orders (customer_id, merchant_id, zone_id, status, payment_method,
         subtotal_centavos, total_centavos, address_snapshot, dropoff)
       values ($1, $2, $3, 'placed', 'cod', 10000, 10000, '{"label":"Home"}',
               extensions.st_setsrid(extensions.st_makepoint(121.0244, 14.5547), 4326)::extensions.geography)
       returning id`,
      [customer, merchant, zone],
    );
    const empty = await failureOf(db(), () =>
      db().query(
        "insert into public.order_support_notes (order_id, author_role, body) values ($1, 'admin', '   ')",
        [order[0]?.id],
      ),
    );
    expect(empty).toMatch(/order_support_notes_body_check/);
  });
});
