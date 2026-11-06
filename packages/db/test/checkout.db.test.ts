import { randomUUID } from "node:crypto";
import { pointEwkt, type LatLng } from "@klikgo/db/testing";
import { beforeEach, expect, it } from "vitest";
import { describeDb, failureOf, useRollbackTransaction } from "./support";

const CENTRE: LatLng = { lat: 14.5547, lng: 121.0244 };

/** Checkout and payments in the database (Phase 5 migration). */
describeDb("checkout: order codes, idempotency, unpaid timeout, refunds", () => {
  const { db, fx } = useRollbackTransaction();
  let customer: string;
  let merchant: string;
  let zone: string;

  beforeEach(async () => {
    // New accounts get the customer role from the signup trigger.
    customer = await fx().user("Checkout Customer");
    const owner = await fx().user("Checkout Owner");
    zone = await fx().zone({ name: "Checkout Zone", centre: CENTRE });
    merchant = await fx().merchant({
      zoneId: zone,
      ownerId: owner,
      name: "Checkout Karinderya",
      location: CENTRE,
    });
  });

  /** An online order waiting for payment, created `ageMinutes` ago. */
  async function unpaidOrder(ageMinutes: number, key: string | null = null): Promise<string> {
    const { rows } = await db().query<{ id: string }>(
      `insert into public.orders (customer_id, merchant_id, zone_id, status, payment_method,
         subtotal_centavos, delivery_fee_centavos, total_centavos, address_snapshot, dropoff,
         idempotency_key, request_hash, created_at)
       values ($1, $2, $3, 'awaiting_payment', 'gcash', 20000, 3900, 23900, '{"label":"Home"}',
               $4::extensions.geography, $5, $6, now() - make_interval(mins => $7))
       returning id`,
      [customer, merchant, zone, pointEwkt(CENTRE), key, key ? "a".repeat(64) : null, ageMinutes],
    );
    const id = rows[0]?.id ?? "";
    await db().query(
      `insert into public.payments (order_id, gateway, intent_id, amount_centavos, status, method)
       values ($1, 'paymongo', $2, 23900, 'pending', 'gcash')`,
      [id, `cs_test_${randomUUID()}`],
    );
    return id;
  }

  it("gives every order a readable KG- code without the writer choosing one", async () => {
    const id = await unpaidOrder(0);
    const { rows } = await db().query<{ code: string }>(
      "select code from public.orders where id = $1",
      [id],
    );
    expect(rows[0]?.code).toMatch(/^KG-[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{6}$/);
  });

  it("allows one order per customer and Idempotency-Key", async () => {
    await unpaidOrder(0, "double-tap-key-123456");
    const err = await failureOf(db(), () => unpaidOrder(0, "double-tap-key-123456"));
    expect(err).toMatch(/orders_customer_idempotency_key/);
  });

  it("cancels online orders left unpaid past the timeout, releases the promo and marks the payment failed", async () => {
    const stale = await unpaidOrder(16);
    const fresh = await unpaidOrder(5);
    const { rows: promo } = await db().query<{ id: string }>(
      `insert into public.promos (code, type, discount_centavos, starts_at, ends_at)
       values ('TIMEOUT' || upper(substr(md5(random()::text), 1, 6)), 'fixed_off', 5000, now(), now() + interval '1 day')
       returning id`,
    );
    await db().query(
      `insert into public.promo_redemptions (promo_id, user_id, order_id, discount_centavos) values ($1, $2, $3, 5000)`,
      [promo[0]?.id, customer, stale],
    );

    const { rows: cancelled } = await db().query<{ n: number }>(
      "select private.cancel_unpaid_orders() as n",
    );
    expect(cancelled[0]?.n).toBeGreaterThanOrEqual(1);

    const { rows } = await db().query<{
      id: string;
      status: string;
      cancel_reason: string | null;
      payment_status: string;
    }>(
      `select id, status, cancel_reason, payment_status from public.orders where id = any($1) order by created_at`,
      [[stale, fresh]],
    );
    expect(rows).toEqual([
      {
        id: stale,
        status: "cancelled",
        cancel_reason: "payment_timeout",
        payment_status: "failed",
      },
      { id: fresh, status: "awaiting_payment", cancel_reason: null, payment_status: "pending" },
    ]);
    const { rows: redemptions } = await db().query(
      "select 1 from public.promo_redemptions where order_id = $1",
      [stale],
    );
    expect(redemptions).toEqual([]);
    const { rows: payment } = await db().query<{ status: string }>(
      "select status from public.payments where order_id = $1",
      [stale],
    );
    expect(payment[0]?.status).toBe("failed");
    const { rows: events } = await db().query<{
      to_status: string;
      actor_role: string | null;
      meta: unknown;
    }>(
      "select to_status, actor_role, meta from public.order_events where order_id = $1 order by id desc limit 1",
      [stale],
    );
    expect(events[0]).toEqual({
      to_status: "cancelled",
      actor_role: null,
      meta: { reason: "payment_timeout", by: "system" },
    });
  });

  it("runs the timeout every minute from pg_cron", async () => {
    const { rows } = await db().query<{ schedule: string; command: string }>(
      "select schedule, command from cron.job where jobname = 'cancel-unpaid-orders'",
    );
    expect(rows).toEqual([
      { schedule: "* * * * *", command: "select private.cancel_unpaid_orders()" },
    ]);
  });

  it("still needs a person's role for any cancellation that is not a platform timeout", async () => {
    const id = await unpaidOrder(0);
    const err = await failureOf(db(), () =>
      db().query(
        "update public.orders set status = 'cancelled', cancel_reason = 'Changed my mind' where id = $1",
        [id],
      ),
    );
    expect(err).toMatch(/orders_cancel_has_reason/);
  });

  it("never refunds more than was paid, across all refunds of a payment", async () => {
    const id = await unpaidOrder(0);
    const err = await failureOf(db(), () =>
      db().query("update public.payments set refunded_centavos = 23901 where order_id = $1", [id]),
    );
    expect(err).toMatch(/payments_refund_within_amount/);
  });

  it("records a paid time for every paid payment", async () => {
    const id = await unpaidOrder(0);
    const err = await failureOf(db(), () =>
      db().query("update public.payments set status = 'paid' where order_id = $1", [id]),
    );
    expect(err).toMatch(/payments_paid_has_time/);
  });

  it("keeps the ledger balanced when an online payment is held as a customer deposit", async () => {
    const id = await unpaidOrder(0);
    const txn = randomUUID();
    await db().query(
      `insert into public.ledger_entries (txn_id, account, party_type, party_id, debit_centavos, credit_centavos, order_id)
       values ($1, 'gateway_clearing', 'platform', null, 23300, 0, $3),
              ($1, 'gateway_fees', 'platform', null, 600, 0, $3),
              ($1, 'customer_deposits', 'customer', $2, 0, 23900, $3)`,
      [txn, customer, id],
    );
    await db().query("set constraints all immediate");
  });
});
