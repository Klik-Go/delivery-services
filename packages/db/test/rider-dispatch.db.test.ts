import { beforeEach, expect, it } from "vitest";
import { describeDb, failureOf, useRollbackTransaction } from "./support";

const CENTRE = { lat: 14.5547, lng: 121.0244 };

/** Phase 7: delivery PINs, rider topics, location and offer broadcasts, delivery proofs. */
describeDb("rider dispatch: PINs, rider topics, broadcasts, proofs", () => {
  const { db, fx } = useRollbackTransaction();
  let customer: string;
  let merchant: string;
  let zone: string;
  let riderUser: string;
  let otherRiderUser: string;
  let rider: string;
  let otherRider: string;

  beforeEach(async () => {
    customer = await fx().user("Dispatch Customer");
    const owner = await fx().user("Dispatch Owner");
    riderUser = await fx().user("Dispatch Rider");
    otherRiderUser = await fx().user("Other Rider");
    zone = await fx().zone({ name: "Dispatch Zone", centre: CENTRE });
    merchant = await fx().merchant({
      zoneId: zone,
      ownerId: owner,
      name: "Dispatch Karinderya",
      location: CENTRE,
    });
    rider = await fx().rider({ userId: riderUser, zoneId: zone, location: CENTRE });
    otherRider = await fx().rider({ userId: otherRiderUser, zoneId: zone, location: CENTRE });
  });

  /** A cash order with the given total (subtotal only, so the total adds up). */
  async function order(totalCentavos: number): Promise<string> {
    const { rows } = await db().query<{ id: string }>(
      `insert into public.orders (customer_id, merchant_id, zone_id, status, payment_method,
         subtotal_centavos, total_centavos, address_snapshot, dropoff)
       values ($1, $2, $3, 'placed', 'cod', $4, $4, '{"label":"Home"}',
               extensions.st_setsrid(extensions.st_makepoint(121.0244, 14.5547), 4326)::extensions.geography)
       returning id`,
      [customer, merchant, zone, totalCentavos],
    );
    return rows[0]?.id ?? "";
  }

  async function pinOf(orderId: string): Promise<string | null> {
    const { rows } = await db().query<{ pin: string }>(
      "select pin from public.order_delivery_pins where order_id = $1",
      [orderId],
    );
    return rows[0]?.pin ?? null;
  }

  async function follows(userId: string, topic: string): Promise<boolean> {
    await db().query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated", aal: "aal1" }),
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

  it("gives orders at or above the threshold (₱500 by default) a 4-digit delivery PIN, and smaller ones none", async () => {
    const big = await order(50000);
    const small = await order(49999);
    expect(await pinOf(big)).toMatch(/^[0-9]{4}$/);
    expect(await pinOf(small)).toBeNull();
  });

  it("follows the threshold in the dispatch settings", async () => {
    await db().query(
      `update public.feature_flags set rollout = rollout || '{"pin_threshold_centavos": 100}'::jsonb where key = 'dispatch'`,
    );
    expect(await pinOf(await order(100))).toMatch(/^[0-9]{4}$/);
  });

  it("lets a rider follow only their own rider topic, and an order's topic once it is theirs", async () => {
    const id = await order(20000);
    expect(await follows(riderUser, `rider:${rider}`)).toBe(true);
    expect(await follows(riderUser, `rider:${otherRider}`)).toBe(false);
    expect(await follows(customer, `rider:${rider}`)).toBe(false);
    expect(await follows(riderUser, `order:${id}`)).toBe(false);
    await fx().assignRider(id, rider);
    expect(await follows(riderUser, `order:${id}`)).toBe(true);
    expect(await follows(otherRiderUser, `order:${id}`)).toBe(false);
  });

  it("broadcasts offers and rider moves without ever blocking the write", async () => {
    const id = await order(20000);
    await fx().offer(id, otherRider);
    await fx().assignRider(id, rider);
    await db().query(
      `update public.rider_locations set location = extensions.st_setsrid(extensions.st_makepoint(121.03, 14.56), 4326)::extensions.geography,
              updated_at = now() where rider_id = $1`,
      [rider],
    );
    const { rows } = await db().query<{ tgname: string }>(
      `select tgname from pg_trigger where tgname in ('dispatch_offers_broadcast', 'rider_locations_broadcast', 'orders_issue_delivery_pin')
        order by tgname`,
    );
    expect(rows.map((r) => r.tgname)).toEqual([
      "dispatch_offers_broadcast",
      "orders_issue_delivery_pin",
      "rider_locations_broadcast",
    ]);
  });

  it("keeps delivery photos in a private bucket and accepts only paths inside the order's folder", async () => {
    const { rows } = await db().query<{ public: boolean }>(
      "select public from storage.buckets where id = 'delivery-proofs'",
    );
    expect(rows[0]?.public).toBe(false);
    const id = await order(20000);
    await db().query("update public.orders set delivery_proof_path = $2 where id = $1", [
      id,
      `${id}/proof.webp`,
    ]);
    const err = await failureOf(db(), () =>
      db().query("update public.orders set delivery_proof_path = '../secret.png' where id = $1", [
        id,
      ]),
    );
    expect(err).toMatch(/delivery_proof_path/);
  });

  it("runs the background jobs every 10 seconds so expired offers move on quickly", async () => {
    const { rows } = await db().query<{ schedule: string }>(
      "select schedule from cron.job where jobname = 'app-jobs'",
    );
    expect(rows[0]?.schedule).toBe("10 seconds");
  });
});
