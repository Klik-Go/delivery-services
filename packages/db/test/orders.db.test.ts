import { ORDER_STATUS_TRANSITIONS, type OrderStatus } from "@klikgo/types";
import { beforeEach, expect, it } from "vitest";
import { type LatLng, offsetLatLng } from "../src/testing";
import { describeDb, failureOf, useRollbackTransaction } from "./support";

const CENTRE: LatLng = { lat: 16.4023, lng: 120.596 };

describeDb("order lifecycle and integrity in the database", () => {
  const { db, fx } = useRollbackTransaction();
  let ctx: { zone: string; merchant: string; customer: string; owner: string };

  beforeEach(async () => {
    const zone = await fx().zone({ name: "Orders", centre: CENTRE });
    const owner = await fx().user("Owner");
    const customer = await fx().user("Customer");
    const merchant = await fx().merchant({
      zoneId: zone,
      ownerId: owner,
      name: "Shop",
      location: CENTRE,
    });
    ctx = { zone, merchant, customer, owner };
  });

  const newOrder = () =>
    fx().order({
      customerId: ctx.customer,
      merchantId: ctx.merchant,
      zoneId: ctx.zone,
      dropoff: offsetLatLng(CENTRE, 300),
    });

  it("allows exactly the transitions in ORDER_STATUS_TRANSITIONS and refuses every other jump", async () => {
    const { rows } = await db().query<{ ok: boolean; from_status: string; to_status: string }>(
      `select f.s::text as from_status, t.s::text as to_status, public.is_valid_order_transition(f.s, t.s) as ok
       from unnest(enum_range(null::public.order_status)) f(s), unnest(enum_range(null::public.order_status)) t(s)`,
    );
    for (const row of rows) {
      const allowed = ORDER_STATUS_TRANSITIONS[row.from_status as OrderStatus].includes(
        row.to_status as OrderStatus,
      );
      expect(row.ok, `${row.from_status} → ${row.to_status}`).toBe(allowed);
    }
  });

  it("refuses to skip steps (placed straight to delivered)", async () => {
    const order = await newOrder();
    const err = await failureOf(db(), () => fx().setStatus(order, "delivered"));
    expect(err).toMatch(/invalid order status transition: placed -> delivered/);
  });

  it("refuses to create an order in a later status", async () => {
    const err = await failureOf(db(), () =>
      db().query(
        `insert into public.orders (code, customer_id, merchant_id, zone_id, status, payment_method, subtotal_centavos, total_centavos, address_snapshot, dropoff)
         select 'KG-LATE01', $1, $2, $3, 'delivered', 'cod', 100, 100, '{}', location from public.merchants where id = $2`,
        [ctx.customer, ctx.merchant, ctx.zone],
      ),
    );
    expect(err).toMatch(/orders_initial_status/);
  });

  it("records every status change in order_events with the actor and stamps the status time", async () => {
    const order = await newOrder();
    await fx().setStatus(order, "accepted", { id: ctx.owner, role: "merchant_owner" });
    const events = await db().query<{
      from_status: string | null;
      to_status: string;
      actor_id: string | null;
      actor_role: string | null;
    }>(
      `select from_status::text, to_status::text, actor_id, actor_role::text from public.order_events where order_id = $1 order by created_at, id`,
      [order],
    );
    expect(events.rows).toEqual([
      { from_status: null, to_status: "placed", actor_id: null, actor_role: null },
      {
        from_status: "placed",
        to_status: "accepted",
        actor_id: ctx.owner,
        actor_role: "merchant_owner",
      },
    ]);
    const stamps = await db().query<{ placed: boolean; accepted: boolean }>(
      `select placed_at is not null as placed, accepted_at is not null as accepted from public.orders where id = $1`,
      [order],
    );
    expect(stamps.rows[0]).toEqual({ placed: true, accepted: true });
  });

  it("keeps the order history append-only", async () => {
    const order = await newOrder();
    for (const sql of [
      `update public.order_events set to_status = 'delivered' where order_id = $1`,
      `delete from public.order_events where order_id = $1`,
    ]) {
      expect(await failureOf(db(), () => db().query(sql, [order]))).toMatch(/append-only/);
    }
  });

  it("requires a reason and an actor role to cancel an order", async () => {
    const order = await newOrder();
    const err = await failureOf(db(), () =>
      db().query(`update public.orders set status = 'cancelled' where id = $1`, [order]),
    );
    expect(err).toMatch(/orders_cancel_has_reason/);
  });

  it("rejects an order whose total does not add up to its parts", async () => {
    const err = await failureOf(db(), () =>
      db()
        .query(
          `update public.orders set total_centavos = total_centavos + 1 where customer_id = $1`,
          [ctx.customer],
        )
        .then(async () =>
          newOrder().then((id) =>
            db().query(`update public.orders set tip_centavos = 500 where id = $1`, [id]),
          ),
        ),
    );
    expect(err).toMatch(/orders_total_adds_up/);
  });

  it("rejects negative money and line totals that do not match price × quantity", async () => {
    const order = await newOrder();
    const negative = await failureOf(db(), () =>
      db().query(
        `insert into public.order_items (order_id, name_snapshot, unit_price_centavos, quantity, line_total_centavos) values ($1, 'X', -100, 1, -100)`,
        [order],
      ),
    );
    expect(negative).toMatch(/check constraint/);
    const wrongLine = await failureOf(db(), () =>
      db().query(
        `insert into public.order_items (order_id, name_snapshot, unit_price_centavos, modifiers_unit_centavos, quantity, line_total_centavos)
         values ($1, 'Halo-halo', 9000, 1500, 2, 18000)`,
        [order],
      ),
    );
    expect(wrongLine).toMatch(/order_items_line_total/);
    const ok = await db().query(
      `insert into public.order_items (order_id, name_snapshot, unit_price_centavos, modifiers_unit_centavos, quantity, line_total_centavos)
       values ($1, 'Halo-halo', 9000, 1500, 2, 21000)`,
      [order],
    );
    expect(ok.rowCount).toBe(1);
  });

  it("lets only one rider accept an order", async () => {
    const order = await newOrder();
    const r1 = await fx().rider({
      userId: await fx().user("R1"),
      zoneId: ctx.zone,
      isOnline: true,
    });
    const r2 = await fx().rider({
      userId: await fx().user("R2"),
      zoneId: ctx.zone,
      isOnline: true,
    });
    await fx().assignRider(order, r1);
    const err = await failureOf(db(), () => fx().assignRider(order, r2));
    expect(err).toMatch(/dispatch_offers_one_accepted_per_order/);
  });
});
