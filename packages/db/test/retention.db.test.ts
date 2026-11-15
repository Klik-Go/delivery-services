import { beforeEach, expect, it } from "vitest";
import { describeDb, failureOf, useRollbackTransaction } from "./support";

const CENTRE = { lat: 14.5547, lng: 121.0244 };
const hash = (c: string): string => c.repeat(64);

/** Phase 9: promo guards under the database lock, rating averages, voucher ownership. */
describeDb("retention: promo guards, rating averages, vouchers", () => {
  const { db, fx } = useRollbackTransaction();
  let zone: string;
  let merchant: string;
  let customer: string;
  let other: string;

  beforeEach(async () => {
    zone = await fx().zone({ name: "Retention Zone", centre: CENTRE });
    const owner = await fx().user("Retention Owner");
    merchant = await fx().merchant({
      zoneId: zone,
      ownerId: owner,
      name: "Retention Store",
      location: CENTRE,
    });
    customer = await fx().user("Rita Repeat");
    other = await fx().user("Oscar Other");
  });

  const order = (customerId: string): Promise<string> =>
    fx().order({ customerId, merchantId: merchant, zoneId: zone, dropoff: CENTRE });

  async function promo(fields: string, values: string): Promise<string> {
    const { rows } = await db().query<{ id: string }>(
      `insert into public.promos (code, type, discount_centavos, starts_at, ends_at${fields})
       values ('T' || upper(substr(md5(random()::text), 1, 8)), 'fixed_off', 5000, now(), now() + interval '1 day'${values})
       returning id`,
    );
    return rows[0]?.id ?? "";
  }

  const redeem = (
    promoId: string,
    userId: string,
    orderId: string,
    extra: { phone?: string; device?: string; amount?: number } = {},
  ) =>
    db().query(
      `insert into public.promo_redemptions (promo_id, user_id, order_id, discount_centavos, phone_hash, device_hash)
       values ($1, $2, $3, $4, $5, $6)`,
      [promoId, userId, orderId, extra.amount ?? 5000, extra.phone ?? null, extra.device ?? null],
    );

  it("refuses a second use from the same device, even from another account", async () => {
    const id = await promo("", "");
    await redeem(id, customer, await order(customer), { device: hash("a") });
    const err = await failureOf(db(), async () =>
      redeem(id, other, await order(other), { device: hash("a") }),
    );
    expect(err).toMatch(/promo_already_used/);
  });

  it("refuses a second use from the same phone number", async () => {
    const id = await promo("", "");
    await redeem(id, customer, await order(customer), { phone: hash("b") });
    const err = await failureOf(db(), async () =>
      redeem(id, other, await order(other), { phone: hash("b") }),
    );
    expect(err).toMatch(/promo_already_used/);
  });

  it("stops at the redemption cap and at the peso budget", async () => {
    const capped = await promo(", max_redemptions", ", 1");
    await redeem(capped, customer, await order(customer));
    expect(await failureOf(db(), async () => redeem(capped, other, await order(other)))).toMatch(
      /promo_used_up/,
    );

    const budget = await promo(", budget_centavos", ", 8000");
    await redeem(budget, customer, await order(customer));
    expect(await failureOf(db(), async () => redeem(budget, other, await order(other)))).toMatch(
      /promo_used_up/,
    );
    // A smaller discount that still fits the budget goes through.
    await redeem(budget, other, await order(other), { amount: 3000 });
  });

  it("a personal voucher works only for its owner", async () => {
    const id = await promo(", owner_id, source", `, '${customer}'::uuid, 'loyalty'`);
    expect(await failureOf(db(), async () => redeem(id, other, await order(other)))).toMatch(
      /promo_not_yours/,
    );
    await redeem(id, customer, await order(customer));
  });

  it("keeps rating averages right after edits, for stores and customers", async () => {
    const orderId = await order(customer);
    const { rows } = await db().query<{ id: string }>(
      `insert into public.ratings (order_id, from_user_id, target_type, target_id, score)
       values ($1, $2, 'merchant', $3, 2), ($1, $4, 'customer', $2, 4) returning id`,
      [orderId, customer, merchant, other],
    );
    await db().query(`update public.ratings set score = 5 where id = $1`, [rows[0]?.id]);
    const store = await db().query<{ rating_avg: string; rating_count: number }>(
      `select rating_avg, rating_count from public.merchants where id = $1`,
      [merchant],
    );
    expect(store.rows[0]).toEqual({ rating_avg: "5.00", rating_count: 1 });
    const person = await db().query<{ rating_avg: string; rating_count: number }>(
      `select rating_avg, rating_count from public.profiles where id = $1`,
      [customer],
    );
    expect(person.rows[0]).toEqual({ rating_avg: "4.00", rating_count: 1 });
  });

  it("allows one referral per device unless the earlier one was voided", async () => {
    const third = await fx().user("Tess Third");
    await db().query(
      `insert into public.referrals (referrer_id, referee_id, code, device_hash) values ($1, $2, 'RITA01', $3)`,
      [customer, other, hash("c")],
    );
    const err = await failureOf(db(), () =>
      db().query(
        `insert into public.referrals (referrer_id, referee_id, code, device_hash) values ($1, $2, 'RITA01', $3)`,
        [customer, third, hash("c")],
      ),
    );
    expect(err).toMatch(/referrals_device_once/);
  });
});
