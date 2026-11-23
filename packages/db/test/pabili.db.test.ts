import { asUser } from "@klikgo/db/testing";
import { beforeEach, expect, it } from "vitest";
import { describeDb, failureOf, useRollbackTransaction } from "./support";

const CENTRE = { lat: 14.5547, lng: 121.0244 };
const SHOP = { lat: 14.5551, lng: 121.0249 };

/** Phase 13: Pabili orders have no store, pay cash, stay within budget and never time out. */
describeDb("pabili: orders without a store", () => {
  const { db, fx } = useRollbackTransaction();
  let customer: string;
  let zone: string;

  beforeEach(async () => {
    customer = await fx().user("Pabili Customer");
    zone = await fx().zone({ name: "Pabili Zone", centre: CENTRE });
  });

  const pabili = (placedOnly = false): Promise<string> =>
    fx().pabiliOrder({
      customerId: customer,
      zoneId: zone,
      pickup: SHOP,
      dropoff: CENTRE,
      placedOnly,
    });

  it("a store order needs a store and a Pabili order has none", async () => {
    const insert = (kind: string, merchant: string | null) =>
      db().query(
        `insert into public.orders (code, customer_id, kind, merchant_id, zone_id, status, payment_method,
           subtotal_centavos, total_centavos, address_snapshot, dropoff)
         values ('KG-ZZZ999', $1, $2::public.order_kind, $3, $4, 'placed', 'cod', 0, 0, '{}',
                 extensions.st_setsrid(extensions.st_makepoint(121.02, 14.55), 4326)::extensions.geography)`,
        [customer, kind, merchant, zone],
      );
    expect(await failureOf(db(), () => insert("store", null))).toMatch(/orders_kind_merchant/);
    const owner = await fx().user("Pabili Owner");
    const merchant = await fx().merchant({
      zoneId: zone,
      ownerId: owner,
      name: "Shop",
      location: SHOP,
    });
    expect(await failureOf(db(), () => insert("pabili", merchant))).toMatch(/orders_kind_merchant/);
  });

  it("Pabili is cash on delivery only", async () => {
    const id = await pabili();
    expect(
      await failureOf(db(), () =>
        db().query("update public.orders set payment_method = 'gcash' where id = $1", [id]),
      ),
    ).toMatch(/orders_pabili_cod/);
  });

  it("the item cost can't go over the budget, and cost, receipt and time are recorded together", async () => {
    const id = await pabili();
    const buy = (cost: number, receipt: string | null) =>
      db().query(
        `update public.pabili_requests set item_cost_centavos = $2, receipt_path = $3, bought_at = now()
          where order_id = $1`,
        [id, cost, receipt],
      );
    expect(await failureOf(db(), () => buy(50_001, "r.jpg"))).toMatch(
      /pabili_requests_within_budget/,
    );
    expect(await failureOf(db(), () => buy(30_000, null))).toMatch(
      /pabili_requests_bought_together/,
    );
    await buy(50_000, `${id}/receipt.jpg`);
    const { rows } = await db().query<{ cost: number }>(
      "select item_cost_centavos as cost from public.pabili_requests where order_id = $1",
      [id],
    );
    expect(rows[0]?.cost).toBe(50_000);
  });

  it("goes through the normal lifecycle and writes order_events for each step", async () => {
    const id = await pabili();
    for (const status of ["preparing", "ready", "picked_up", "delivered"] as const) {
      await fx().setStatus(id, status);
    }
    const { rows } = await db().query<{ to_status: string }>(
      "select to_status::text from public.order_events where order_id = $1 order by id",
      [id],
    );
    expect(rows.map((r) => r.to_status)).toEqual([
      "placed",
      "accepted",
      "preparing",
      "ready",
      "picked_up",
      "delivered",
    ]);
  });

  it("the store deadline never touches a Pabili order, even one left waiting", async () => {
    await db().query("update public.feature_flags set enabled = true where key = 'merchant_sla'");
    const id = await pabili(true);
    await db().query(
      "update public.orders set placed_at = now() - interval '10 minutes' where id = $1",
      [id],
    );
    await db().query("select private.escalate_merchant_sla()");
    const { rows } = await db().query<{ status: string; sms: Date | null }>(
      "select status::text, sla_sms_at as sms from public.orders where id = $1",
      [id],
    );
    expect(rows[0]).toEqual({ status: "placed", sms: null });
  });

  it("the pickup view names the shop for Pabili and the store otherwise; clients can't read it", async () => {
    const id = await pabili();
    const owner = await fx().user("Pickup Owner");
    const merchant = await fx().merchant({
      zoneId: zone,
      ownerId: owner,
      name: "Karinderya",
      location: CENTRE,
    });
    const store = await fx().order({
      customerId: customer,
      merchantId: merchant,
      zoneId: zone,
      dropoff: CENTRE,
    });
    const { rows } = await db().query<{
      order_id: string;
      name: string;
      address_line: string | null;
      lat: number;
    }>(
      `select order_id, name, address_line, round(extensions.st_y(location::extensions.geometry)::numeric, 4)::float8 as lat
         from private.order_pickups where order_id = any($1) order by name`,
      [[id, store]],
    );
    expect(rows).toEqual([
      {
        order_id: id,
        name: "Aling Nena Sari-sari",
        address_line: "Beside the chapel",
        lat: 14.5551,
      },
      { order_id: store, name: "Karinderya", address_line: null, lat: 14.5547 },
    ]);
    const error = await asUser(db(), customer, () =>
      failureOf(db(), () => db().query("select * from private.order_pickups")),
    );
    expect(error).toMatch(/permission denied/);
  });

  it("erasing the customer's account clears list notes and shop notes but keeps the items", async () => {
    const id = await pabili();
    await db().query("select private.erase_account($1)", [customer]);
    const items = await db().query<{ description: string; note: string | null }>(
      "select description, note from public.pabili_items where order_id = $1 order by position",
      [id],
    );
    expect(items.rows).toEqual([
      { description: "Eggs (medium)", note: null },
      { description: "Pandesal", note: null },
    ]);
    const request = await db().query<{ store_notes: string | null }>(
      "select store_notes from public.pabili_requests where order_id = $1",
      [id],
    );
    expect(request.rows[0]?.store_notes).toBeNull();
  });
});
