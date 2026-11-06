import type pg from "pg";
import { type DbFixtures, type LatLng, offsetLatLng } from "../src/testing";

export const CENTRE_A: LatLng = { lat: 14.5995, lng: 120.9842 };
export const CENTRE_B: LatLng = { lat: 10.3157, lng: 123.8854 };

/**
 * A small but complete world for isolation tests: two zones, two merchants, customers, riders,
 * coordinators and an admin, with orders in different states and one row in every table.
 */
export interface World {
  readonly users: Record<
    | "customer1"
    | "customer2"
    | "ownerA"
    | "staffA"
    | "ownerB"
    | "riderA1"
    | "riderA2"
    | "riderB"
    | "coordA"
    | "coordB"
    | "admin",
    string
  >;
  readonly zoneA: string;
  readonly zoneB: string;
  readonly pausedZone: string;
  readonly merchantA: string;
  readonly merchantB: string;
  readonly pendingMerchant: string;
  /** Partner applications: one in zone A, one in zone B, one outside every zone. */
  readonly applications: Record<"A" | "B" | "outside", string>;
  readonly riders: Record<"A1" | "A2" | "B", string>;
  /** order1: customer1 @ A, delivered by riderA1. */
  readonly order1: string;
  /** order2: customer2 @ B (zone B), placed. */
  readonly order2: string;
  /** order3: customer2 @ A, placed, offered to riderA2. */
  readonly order3: string;
  /** order4: customer1 @ A, picked up by riderA1 (active delivery). */
  readonly order4: string;
}

export async function buildWorld(db: pg.ClientBase, fx: DbFixtures): Promise<World> {
  const admin = await fx.user("Ada Admin", [{ role: "admin" }]);
  const customer1 = await fx.user("Carmen Customer");
  const customer2 = await fx.user("Diego Customer");
  const ownerA = await fx.user("Nena Owner");
  const staffA = await fx.user("Sam Staff");
  const ownerB = await fx.user("Tess Owner");
  const riderA1User = await fx.user("Rico Rider");
  const riderA2User = await fx.user("Rosa Rider");
  const riderBUser = await fx.user("Ramon Rider");

  const zoneA = await fx.zone({ name: "Zone A", centre: CENTRE_A });
  const zoneB = await fx.zone({ name: "Zone B", centre: CENTRE_B });
  const pausedZone = await fx.zone({
    name: "Paused",
    centre: offsetLatLng(CENTRE_A, 30_000),
    isActive: false,
  });
  const coordA = await fx.user("Cora Coordinator", [{ role: "coordinator", zoneId: zoneA }]);
  const coordB = await fx.user("Caloy Coordinator", [{ role: "coordinator", zoneId: zoneB }]);

  const merchantA = await fx.merchant({
    zoneId: zoneA,
    ownerId: ownerA,
    name: "Aling Nena",
    location: CENTRE_A,
  });
  await fx.grantRole(staffA, { role: "merchant_staff", merchantId: merchantA });
  const merchantB = await fx.merchant({
    zoneId: zoneB,
    ownerId: ownerB,
    name: "Kape ni Tess",
    location: CENTRE_B,
  });
  const pendingMerchant = await fx.merchant({
    zoneId: zoneA,
    ownerId: ownerB,
    name: "Not Yet Live",
    location: offsetLatLng(CENTRE_A, 200),
  });
  await db.query(`update public.merchants set status = 'pending' where id = $1`, [pendingMerchant]);
  for (const merchantId of [merchantA, merchantB, pendingMerchant]) {
    const item = await fx.menuItem({ merchantId, name: "Adobo rice", priceCentavos: 12000 });
    const group = await db.query<{ id: string }>(
      `insert into public.modifier_groups (menu_item_id, name, min_select, max_select, is_required)
       values ($1, 'Size', 1, 1, true) returning id`,
      [item],
    );
    await db.query(
      `insert into public.modifier_options (modifier_group_id, name, price_delta_centavos) values ($1, 'Large', 2000)`,
      [group.rows[0]?.id],
    );
  }

  const riderA1 = await fx.rider({
    userId: riderA1User,
    zoneId: zoneA,
    isOnline: true,
    location: CENTRE_A,
  });
  const riderA2 = await fx.rider({
    userId: riderA2User,
    zoneId: zoneA,
    isOnline: true,
    location: CENTRE_A,
  });
  const riderB = await fx.rider({
    userId: riderBUser,
    zoneId: zoneB,
    isOnline: true,
    location: CENTRE_B,
  });
  await db.query(
    `insert into public.rider_location_breadcrumbs (rider_id, location) select rider_id, location from public.rider_locations where rider_id = any($1)`,
    [[riderA1, riderB]],
  );
  await fx.kycDocument(riderA1);
  await fx.kycDocument(riderB);

  await fx.address({ userId: customer1, location: offsetLatLng(CENTRE_A, 500) });
  await fx.address({ userId: customer2, location: offsetLatLng(CENTRE_B, 500) });

  const dropA = offsetLatLng(CENTRE_A, 600);
  const order1 = await fx.order({
    customerId: customer1,
    merchantId: merchantA,
    zoneId: zoneA,
    dropoff: dropA,
  });
  await fx.assignRider(order1, riderA1);
  for (const status of ["accepted", "preparing", "ready", "picked_up", "delivered"] as const)
    await fx.setStatus(order1, status);
  const order2 = await fx.order({
    customerId: customer2,
    merchantId: merchantB,
    zoneId: zoneB,
    dropoff: offsetLatLng(CENTRE_B, 600),
  });
  const order3 = await fx.order({
    customerId: customer2,
    merchantId: merchantA,
    zoneId: zoneA,
    dropoff: dropA,
  });
  await fx.offer(order3, riderA2);
  const order4 = await fx.order({
    customerId: customer1,
    merchantId: merchantA,
    zoneId: zoneA,
    dropoff: dropA,
  });
  await fx.assignRider(order4, riderA1);
  for (const status of ["accepted", "preparing", "ready", "picked_up"] as const)
    await fx.setStatus(order4, status);

  for (const orderId of [order1, order2]) {
    await db.query(
      `insert into public.order_items (order_id, name_snapshot, unit_price_centavos, quantity, line_total_centavos)
       values ($1, 'Adobo rice', 10000, 2, 20000)`,
      [orderId],
    );
    await db.query(
      `insert into public.payments (order_id, gateway, intent_id, amount_centavos, status, method)
       values ($1::uuid, 'cod', 'cod-' || $1::text, 23900, 'pending', 'cod')`,
      [orderId],
    );
  }
  await db.query(
    `insert into public.webhook_events (gateway, event_id, type, payload) values ('paymongo', 'evt_test_1', 'payment.paid', '{}')`,
  );
  for (const orderId of [order1, order2]) {
    await db.query(
      `insert into public.refunds (order_id, payment_id, amount_centavos, reason, status)
       select $1, p.id, 1000, 'Missing item', 'succeeded' from public.payments p where p.order_id = $1`,
      [orderId],
    );
  }

  const ledger = `insert into public.ledger_entries (txn_id, account, party_type, party_id, debit_centavos, credit_centavos, order_id)
    values ($1, 'rider_cash_on_hand', 'rider', $2, 23900, 0, $4),
           ($1, 'merchant_payable', 'merchant', $3, 0, 20000, $4),
           ($1, 'rider_payable', 'rider', $2, 0, 3900, $4)`;
  await db.query(ledger, [crypto.randomUUID(), riderA1, merchantA, order1]);
  await db.query(ledger, [crypto.randomUUID(), riderB, merchantB, order2]);
  await db.query(
    `insert into public.payouts (party_type, party_id, period_start, period_end, amount_centavos)
     values ('merchant', $1, current_date - 7, current_date - 1, 20000), ('merchant', $2, current_date - 7, current_date - 1, 20000)`,
    [merchantA, merchantB],
  );

  await db.query(
    `insert into public.ratings (order_id, from_user_id, target_type, target_id, score, tags)
     values ($1, $2, 'merchant', $3, 5, '{Hot food}')`,
    [order1, customer1, merchantA],
  );
  const promo = await db.query<{ id: string }>(
    `insert into public.promos (code, type, discount_centavos, starts_at, ends_at)
     values ('BAGONG' || upper(substr(md5(random()::text), 1, 6)), 'fixed_off', 5000, now(), now() + interval '30 days') returning id`,
  );
  await db.query(
    `insert into public.promo_redemptions (promo_id, user_id, order_id, discount_centavos) values ($1, $2, $3, 5000)`,
    [promo.rows[0]?.id, customer1, order1],
  );
  await db.query(
    `insert into public.referrals (referrer_id, referee_id, code) values ($1, $2, 'CARMEN')`,
    [customer1, customer2],
  );
  await db.query(`insert into public.loyalty_stamps (customer_id, order_id) values ($1, $2)`, [
    customer1,
    order1,
  ]);
  await db.query(
    `insert into public.device_push_subscriptions (user_id, endpoint, p256dh, auth)
     values ($1::uuid, 'https://push.example.test/' || $1::text, 'key', 'auth')`,
    [customer1],
  );
  await db.query(
    `insert into public.notifications (user_id, channel, template, order_id) values ($1, 'push', 'order_delivered', $2)`,
    [customer1, order1],
  );
  await db.query(
    `insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id)
     values ($1, 'admin', 'kyc.view', 'rider_kyc_documents', null)`,
    [admin],
  );
  await db.query(
    `insert into public.invites (email, role, merchant_id, invited_by, expires_at)
     values ('newstaff@example.test', 'merchant_staff', $1, $2, now() + interval '7 days')`,
    [merchantA, ownerA],
  );
  await db.query(
    `insert into public.fee_rules (zone_id, name, kind, min_distance_m, max_distance_m, fee_centavos)
     values ($1, '0-2 km', 'delivery_distance_band', 0, 2000, 3900), ($2, 'paused 0-2 km', 'delivery_distance_band', 0, 2000, 3900)`,
    [zoneA, pausedZone],
  );
  const application = async (name: string, at: LatLng, zoneId: string | null): Promise<string> => {
    const row = await db.query<{ id: string }>(
      `insert into public.merchant_applications (business_name, owner_name, phone, email, barangay, city, location, zone_id)
       values ($1, 'Applicant', '+639170000999', 'apply@example.test', 'Poblacion', 'Placeholder City',
               extensions.st_setsrid(extensions.st_makepoint($2, $3), 4326)::extensions.geography, $4)
       returning id`,
      [name, at.lng, at.lat, zoneId],
    );
    return row.rows[0]?.id ?? "";
  };
  const applications = {
    A: await application("Lugaw sa Kanto", offsetLatLng(CENTRE_A, 300), zoneA),
    B: await application("Puto ni Lola", offsetLatLng(CENTRE_B, 300), zoneB),
    outside: await application("Malayong Kainan", offsetLatLng(CENTRE_A, 60_000), null),
  };
  await db.query(
    `insert into public.waitlist_signups (name, phone, barangay, location)
     values ('Far Customer', '+639170000998', 'Somewhere',
             extensions.st_setsrid(extensions.st_makepoint($1, $2), 4326)::extensions.geography)`,
    [CENTRE_A.lng + 1, CENTRE_A.lat + 1],
  );
  await db.query(
    `insert into public.merchant_closures (merchant_id, closed_on, reason) values ($1, current_date + 7, 'Fiesta'), ($2, current_date + 7, 'Fiesta')`,
    [merchantA, pendingMerchant],
  );
  await db.query(
    `insert into public.feature_flags (key, description, enabled) values ('pabili_mode_test', 'Pabili (buy-for-me)', false)
     on conflict (key) do nothing`,
  );

  return {
    users: {
      customer1,
      customer2,
      ownerA,
      staffA,
      ownerB,
      riderA1: riderA1User,
      riderA2: riderA2User,
      riderB: riderBUser,
      coordA,
      coordB,
      admin,
    },
    zoneA,
    zoneB,
    pausedZone,
    merchantA,
    merchantB,
    pendingMerchant,
    applications,
    riders: { A1: riderA1, A2: riderA2, B: riderB },
    order1,
    order2,
    order3,
    order4,
  };
}
