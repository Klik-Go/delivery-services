import { beforeEach, expect, it } from "vitest";
import { asUser, offsetLatLng, pointEwkt } from "../src/testing";
import { describeDb, failureOf, useRollbackTransaction } from "./support";
import { buildWorld, CENTRE_A, type World } from "./world";

describeDb("row-level security: what each role may change", () => {
  const { db, fx } = useRollbackTransaction();
  let w: World;

  beforeEach(async () => {
    w = await buildWorld(db(), fx());
  });

  it("a customer manages their own addresses but cannot write someone else's", async () => {
    const mine = await asUser(db(), w.users.customer1, () =>
      db().query(
        `insert into public.addresses (user_id, label, location, barangay, city) values ($1, 'Work', $2::extensions.geography, 'Poblacion', 'Placeholder City') returning id`,
        [w.users.customer1, pointEwkt(offsetLatLng(CENTRE_A, 100))],
      ),
    );
    expect(mine.rowCount).toBe(1);

    const theirs = await asUser(db(), w.users.customer1, () =>
      failureOf(db(), () =>
        db().query(
          `insert into public.addresses (user_id, label, location, barangay, city) values ($1, 'Sneaky', $2::extensions.geography, 'X', 'Y')`,
          [w.users.customer2, pointEwkt(CENTRE_A)],
        ),
      ),
    );
    expect(theirs).toMatch(/row-level security/);
  });

  it("a person can rename themself but cannot change their own account status", async () => {
    const renamed = await asUser(db(), w.users.customer1, () =>
      db().query(`update public.profiles set full_name = 'Carmen C.' where id = $1`, [
        w.users.customer1,
      ]),
    );
    expect(renamed.rowCount).toBe(1);
    const status = await asUser(db(), w.users.customer1, () =>
      failureOf(db(), () =>
        db().query(`update public.profiles set status = 'active' where id = $1`, [
          w.users.customer1,
        ]),
      ),
    );
    expect(status).toMatch(/permission denied/);
  });

  it("nobody can grant themself a role from the client", async () => {
    const err = await asUser(db(), w.users.customer1, () =>
      failureOf(db(), () =>
        db().query(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [
          w.users.customer1,
        ]),
      ),
    );
    expect(err).toMatch(/row-level security|permission denied/);
  });

  it("customers cannot create or change orders directly; orders go through the server", async () => {
    const insert = await asUser(db(), w.users.customer1, () =>
      failureOf(db(), () =>
        db().query(
          `insert into public.orders (code, customer_id, merchant_id, zone_id, status, payment_method, subtotal_centavos, total_centavos, address_snapshot, dropoff)
           values ('KG-HACK', $1, $2, $3, 'placed', 'cod', 100, 100, '{}', $4::extensions.geography)`,
          [w.users.customer1, w.merchantA, w.zoneA, pointEwkt(CENTRE_A)],
        ),
      ),
    );
    expect(insert).toMatch(/row-level security|permission denied/);
    // No client write grant on orders at all, so this fails outright rather than matching 0 rows.
    const update = await asUser(db(), w.users.customer1, () =>
      failureOf(db(), () =>
        db().query(`update public.orders set total_centavos = 1 where id = $1`, [w.order4]),
      ),
    );
    expect(update).toMatch(/permission denied/);
  });

  it("merchant staff can mark their own items sold out, not another store's", async () => {
    const own = await asUser(db(), w.users.staffA, () =>
      db().query(`update public.menu_items set is_available = false where merchant_id = $1`, [
        w.merchantA,
      ]),
    );
    expect(own.rowCount).toBeGreaterThan(0);
    const other = await asUser(db(), w.users.staffA, () =>
      db().query(`update public.menu_items set is_available = false where merchant_id = $1`, [
        w.merchantB,
      ]),
    );
    expect(other.rowCount).toBe(0);
  });

  it("a merchant owner can open the store but cannot change their commission or approval status", async () => {
    const open = await asUser(db(), w.users.ownerA, () =>
      db().query(`update public.merchants set is_open = false where id = $1`, [w.merchantA]),
    );
    expect(open.rowCount).toBe(1);
    for (const column of ["commission_bps = 0", "status = 'active'"]) {
      const err = await asUser(db(), w.users.ownerA, () =>
        failureOf(db(), () =>
          db().query(`update public.merchants set ${column} where id = $1`, [w.merchantA]),
        ),
      );
      expect(err, column).toMatch(/permission denied/);
    }
  });

  it("a rider can report their own location and go offline, but not approve themself", async () => {
    const moved = await asUser(db(), w.users.riderA1, () =>
      db().query(
        `update public.rider_locations set location = $2::extensions.geography, updated_at = now() where rider_id = $1`,
        [w.riders.A1, pointEwkt(offsetLatLng(CENTRE_A, 50))],
      ),
    );
    expect(moved.rowCount).toBe(1);
    const spoof = await asUser(db(), w.users.riderA1, () =>
      db().query(`update public.rider_locations set updated_at = now() where rider_id = $1`, [
        w.riders.A2,
      ]),
    );
    expect(spoof.rowCount).toBe(0);
    const offline = await asUser(db(), w.users.riderA1, () =>
      db().query(`update public.riders set is_online = false where id = $1`, [w.riders.A1]),
    );
    expect(offline.rowCount).toBe(1);
    const approve = await asUser(db(), w.users.riderA1, () =>
      failureOf(db(), () =>
        db().query(`update public.riders set status = 'active' where id = $1`, [w.riders.A1]),
      ),
    );
    expect(approve).toMatch(/permission denied/);
  });

  it("a rider uploads KYC documents for themself only", async () => {
    const mine = await asUser(db(), w.users.riderA2, () =>
      db().query(
        `insert into public.rider_kyc_documents (rider_id, type, storage_path) values ($1::uuid, 'selfie_with_id', $1::text || '/selfie.jpg')`,
        [w.riders.A2],
      ),
    );
    expect(mine.rowCount).toBe(1);
    const theirs = await asUser(db(), w.users.riderA2, () =>
      failureOf(db(), () =>
        db().query(
          `insert into public.rider_kyc_documents (rider_id, type, storage_path) values ($1::uuid, 'selfie_with_id', $1::text || '/x.jpg')`,
          [w.riders.A1],
        ),
      ),
    );
    expect(theirs).toMatch(/row-level security/);
  });

  it("payout accounts, payouts and cash hand-ins are written by the server only", async () => {
    for (const user of [w.users.ownerA, w.users.riderA1, w.users.admin, w.users.coordA]) {
      const attempts = [
        () =>
          db().query(
            `insert into public.payout_accounts (party_type, party_id, method, account_name, account_number)
           values ('merchant', $1, 'gcash', 'Sneaky', '09171111111')
           on conflict (party_type, party_id) do update set account_number = excluded.account_number`,
            [w.merchantA],
          ),
        () =>
          db().query(`update public.payouts set status = 'paid', reference = 'X', paid_at = now()`),
        () =>
          db().query(
            `insert into public.cod_remittances (rider_id, zone_id, amount_centavos, reference, ledger_txn_id)
           values ($1, $2, 1, 'x', gen_random_uuid())`,
            [w.riders.A1, w.zoneA],
          ),
      ];
      for (const attempt of attempts) {
        const error = await asUser(db(), user, () => failureOf(db(), attempt));
        expect(error).toMatch(/permission denied/);
      }
    }
  });

  it("ratings and support tickets are written by the server only, never by a client", async () => {
    for (const user of [w.users.customer1, w.users.riderA1, w.users.admin]) {
      const rating = await asUser(db(), user, () =>
        failureOf(db(), () =>
          db().query(
            `insert into public.ratings (order_id, from_user_id, target_type, target_id, score) values ($1, $2, 'merchant', $3, 5)`,
            [w.order1, user, w.merchantA],
          ),
        ),
      );
      expect(rating).toMatch(/permission denied/);
      const ticket = await asUser(db(), user, () =>
        failureOf(db(), () =>
          db().query(
            `insert into public.support_tickets (kind, order_id, zone_id, summary) values ('low_rating', $1, $2, 'x')`,
            [w.order1, w.zoneA],
          ),
        ),
      );
      expect(ticket).toMatch(/permission denied/);
    }
  });

  it("people manage their own push subscriptions and mark their own notifications read", async () => {
    const sub = await asUser(db(), w.users.customer2, () =>
      db().query(
        `insert into public.device_push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example.test/d2', 'k', 'a')`,
        [w.users.customer2],
      ),
    );
    expect(sub.rowCount).toBe(1);
    const read = await asUser(db(), w.users.customer1, () =>
      db().query(`update public.notifications set read_at = now() where user_id = $1`, [
        w.users.customer1,
      ]),
    );
    expect(read.rowCount).toBe(1);
    const others = await asUser(db(), w.users.customer2, () =>
      db().query(`update public.notifications set read_at = now() where user_id = $1`, [
        w.users.customer1,
      ]),
    );
    expect(others.rowCount).toBe(0);
  });

  it("anonymous visitors cannot write anything", async () => {
    const err = await asUser(db(), null, () =>
      failureOf(db(), () =>
        db().query(`insert into public.feature_flags (key, enabled) values ('anon_flag', true)`),
      ),
    );
    expect(err).toMatch(/row-level security|permission denied/);
  });

  it("partner applications are written by the server only, not by any signed-in role", async () => {
    for (const actor of [w.users.customer1, w.users.admin, null]) {
      const err = await asUser(db(), actor, () =>
        failureOf(db(), () =>
          db().query(
            `update public.merchant_applications set status = 'rejected', reviewed_at = now() where id = $1`,
            [w.applications.A],
          ),
        ),
      );
      expect(err, String(actor)).toMatch(/permission denied/);
    }
  });

  it("merchant staff manage their own store's closures and service radius, not another store's", async () => {
    const own = await asUser(db(), w.users.staffA, () =>
      db().query(
        `insert into public.merchant_closures (merchant_id, closed_on, reason) values ($1, current_date + 30, 'Undas')`,
        [w.merchantA],
      ),
    );
    expect(own.rowCount).toBe(1);
    const other = await asUser(db(), w.users.staffA, () =>
      failureOf(db(), () =>
        db().query(
          `insert into public.merchant_closures (merchant_id, closed_on) values ($1, current_date + 30)`,
          [w.merchantB],
        ),
      ),
    );
    expect(other).toMatch(/row-level security/);
    const radius = await asUser(db(), w.users.ownerA, () =>
      db().query(`update public.merchants set service_radius_km = 3 where id = $1`, [w.merchantA]),
    );
    expect(radius.rowCount).toBe(1);
    const founding = await asUser(db(), w.users.ownerA, () =>
      failureOf(db(), () =>
        db().query(
          `update public.merchants set founding_commission_until = now() + interval '10 years' where id = $1`,
          [w.merchantA],
        ),
      ),
    );
    expect(founding).toMatch(/permission denied/);
  });

  it("a store's service radius can never exceed its zone's maximum", async () => {
    const err = await failureOf(db(), () =>
      db().query(`update public.merchants set service_radius_km = 50 where id = $1`, [w.merchantA]),
    );
    expect(err).toMatch(/above the zone maximum/);
  });

  it("support notes are written by the server only, never by a client (not even staff)", async () => {
    for (const user of [w.users.coordA, w.users.admin, w.users.customer1]) {
      const err = await asUser(db(), user, () =>
        failureOf(db(), () =>
          db().query(
            `insert into public.order_support_notes (order_id, author_id, author_role, body)
             values ($1, $2, 'admin', 'Sneaky')`,
            [w.order1, user],
          ),
        ),
      );
      expect(err).toMatch(/permission denied/);
    }
  });

  it("delivery PINs are written by the database only, never by a client", async () => {
    for (const user of [w.users.customer1, w.users.riderA1, w.users.ownerA]) {
      const err = await asUser(db(), user, () =>
        failureOf(db(), () =>
          db().query(`update public.order_delivery_pins set pin = '0000' where order_id = $1`, [
            w.order1,
          ]),
        ),
      );
      expect(err).toMatch(/permission denied/);
    }
  });

  it("refunds and payments are written by the server only, never by a client", async () => {
    for (const actor of [w.users.customer1, w.users.admin, null]) {
      const insert = await asUser(db(), actor, () =>
        failureOf(db(), () =>
          db().query(
            `insert into public.refunds (order_id, payment_id, amount_centavos, reason)
             select p.order_id, p.id, 100, 'Hack' from public.payments p limit 1`,
          ),
        ),
      );
      expect(insert, String(actor)).toMatch(/permission denied|row-level security/);
      const update = await asUser(db(), actor, () =>
        failureOf(db(), () =>
          db().query(`update public.payments set refunded_centavos = 0 where order_id = $1`, [
            w.order1,
          ]),
        ),
      );
      expect(update, String(actor)).toMatch(/permission denied/);
    }
  });

  it("consents and job runs are written by the server only, never by a client", async () => {
    for (const user of [w.users.customer1, w.users.admin]) {
      const attempts = [
        () =>
          db().query(
            `insert into public.consents (user_id, document, version) values ($1, 'terms', '2030-01-01')`,
            [user],
          ),
        () => db().query(`delete from public.consents where user_id = $1`, [user]),
        () => db().query(`insert into public.job_runs (job) values ('background')`),
        () => db().query(`update public.job_runs set ok = false`),
      ];
      for (const attempt of attempts) {
        const error = await asUser(db(), user, () => failureOf(db(), attempt));
        expect(error).toMatch(/permission denied/);
      }
    }
  });

  it("the waitlist is written by the server only, never directly by a client", async () => {
    for (const actor of [w.users.customer1, w.users.admin, null]) {
      const err = await asUser(db(), actor, () =>
        failureOf(db(), () =>
          db().query(
            `insert into public.waitlist_signups (name, phone, barangay, location)
             values ('X', '+639170000997', 'Y', 'SRID=4326;POINT(121 14)')`,
          ),
        ),
      );
      expect(err, String(actor)).toMatch(/permission denied/);
    }
  });
});
