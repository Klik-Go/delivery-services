import { beforeEach, expect, it } from "vitest";
import { describeDb, failureOf, useRollbackTransaction } from "./support";

const CENTRE = { lat: 14.5547, lng: 121.0244 };

/** Phase 11: consent records, account erasure, KYC retention, job runs and the new switches. */
describeDb("hardening: consents, erasure, KYC retention, job runs", () => {
  const { db, fx } = useRollbackTransaction();
  let zone: string;
  let merchant: string;
  let customer: string;
  let other: string;

  beforeEach(async () => {
    zone = await fx().zone({ name: "Hardening Zone", centre: CENTRE });
    const owner = await fx().user("Hardening Owner");
    merchant = await fx().merchant({
      zoneId: zone,
      ownerId: owner,
      name: "Hardening Store",
      location: CENTRE,
    });
    customer = await fx().user("Erin Erase");
    other = await fx().user("Kim Keep");
  });

  const delivered = (customerId: string): Promise<string> =>
    fx().order({
      customerId,
      merchantId: merchant,
      zoneId: zone,
      dropoff: { lat: 14.55471234, lng: 121.02445678 },
      advanceTo: ["accepted", "preparing", "ready", "picked_up", "delivered"],
    });

  it("records one agreement per document and version", async () => {
    const accept = (version: string) =>
      db().query(
        `insert into public.consents (user_id, document, version) values ($1, 'terms', $2)`,
        [customer, version],
      );
    await accept("2026-11-23");
    expect(await failureOf(db(), () => accept("2026-11-23"))).toMatch(/duplicate key/);
    expect(await failureOf(db(), () => accept("v2"))).toMatch(/consents_version_check/);
    await accept("2027-01-01");
  });

  it("erases a customer's contact details, addresses and order address but keeps the amounts", async () => {
    await fx().address({ userId: customer, location: CENTRE });
    await fx().address({ userId: other, location: CENTRE });
    const order = await delivered(customer);
    const kept = await delivered(other);
    await db().query(
      `insert into public.ratings (order_id, from_user_id, target_type, target_id, score, comment)
       values ($1, $2, 'merchant', $3, 4, 'Kuya Ben was so kind, call me at 0917 123 4567')`,
      [order, customer, merchant],
    );

    const { rows } = await db().query<{ result: { orders: number; addresses: number } }>(
      "select private.erase_account($1) as result",
      [customer],
    );
    expect(rows[0]?.result).toMatchObject({ orders: 1, addresses: 1, rider: false });

    const profile = await db().query(
      "select full_name, phone, email, status from public.profiles where id = $1",
      [customer],
    );
    expect(profile.rows[0]).toEqual({
      full_name: null,
      phone: null,
      email: null,
      status: "deleted",
    });
    const roles = await db().query("select 1 from public.user_roles where user_id = $1", [
      customer,
    ]);
    expect(roles.rowCount).toBe(0);
    const addresses = await db().query<{ user_id: string }>(
      "select user_id from public.addresses where user_id = any($1)",
      [[customer, other]],
    );
    expect(addresses.rows.map((r) => r.user_id)).toEqual([other]);

    const orders = await db().query<{
      id: string;
      total_centavos: number;
      address_snapshot: Record<string, unknown>;
      lat: number;
    }>(
      `select id, total_centavos, address_snapshot, extensions.st_y(dropoff::extensions.geometry) as lat
         from public.orders where id = any($1)`,
      [[order, kept]],
    );
    const erased = orders.rows.find((r) => r.id === order);
    expect(erased?.total_centavos).toBe(23900);
    expect(erased?.address_snapshot).toEqual({ erased: true });
    expect(erased?.lat).toBeCloseTo(14.55, 5);
    expect(orders.rows.find((r) => r.id === kept)?.address_snapshot).toHaveProperty("landmark");

    const rating = await db().query<{ comment: string | null; score: number }>(
      "select comment, score from public.ratings where order_id = $1",
      [order],
    );
    expect(rating.rows[0]).toEqual({ comment: null, score: 4 });

    // Erasing twice is harmless (a retry after the auth step failed).
    const again = await db().query<{ result: { orders: number } }>(
      "select private.erase_account($1) as result",
      [customer],
    );
    expect(again.rows[0]?.result.orders).toBe(0);
  });

  it("erases a rider's location history and payout account and queues their ID files", async () => {
    const user = await fx().user("Ria Rider");
    const rider = await fx().rider({ userId: user, zoneId: zone, location: CENTRE });
    await db().query(
      `insert into public.payout_accounts (party_type, party_id, method, account_name, account_number)
       values ('rider', $1, 'gcash', 'Ria Rider', '09170000001')`,
      [rider],
    );
    await db().query(
      `insert into public.rider_kyc_documents (rider_id, type, storage_path, status)
       values ($1::uuid, 'government_id', $1::text || '/id.jpg', 'approved')`,
      [rider],
    );
    const due = () =>
      db().query<{ rider_id: string }>(
        "select rider_id from private.kyc_documents_due_for_purge() where rider_id = $1",
        [rider],
      );
    expect((await due()).rowCount).toBe(0);

    await db().query("select private.erase_account($1)", [user]);
    const state = await db().query(
      `select r.status, r.is_online,
              (select count(*)::int from public.rider_locations where rider_id = r.id) as locations,
              (select count(*)::int from public.payout_accounts where party_id = r.id) as accounts
         from public.riders r where r.id = $1`,
      [rider],
    );
    expect(state.rows[0]).toEqual({
      status: "suspended",
      is_online: false,
      locations: 0,
      accounts: 0,
    });
    expect((await due()).rows).toEqual([{ rider_id: rider }]);
  });

  it("finds rejected ID files past the retention period, and respects the switch", async () => {
    const user = await fx().user("Rex Rejected");
    const rider = await fx().rider({ userId: user, zoneId: zone, status: "pending_kyc" });
    await db().query(
      `insert into public.rider_kyc_documents (rider_id, type, storage_path, status, reviewed_at, rejection_reason)
       values ($1::uuid, 'government_id', $1::text || '/old.jpg', 'rejected', now() - interval '91 days', 'Blurry'),
              ($1::uuid, 'selfie_with_id', $1::text || '/new.jpg', 'rejected', now() - interval '10 days', 'Blurry')`,
      [rider],
    );
    const due = async () =>
      (
        await db().query<{ storage_path: string }>(
          "select storage_path from private.kyc_documents_due_for_purge() where rider_id = $1",
          [rider],
        )
      ).rows.map((r) => r.storage_path);
    expect(await due()).toEqual([`${rider}/old.jpg`]);

    await db().query(
      `update public.rider_kyc_documents set purged_at = now() where storage_path = $1`,
      [`${rider}/old.jpg`],
    );
    expect(await due()).toEqual([]);

    await db().query(
      `update public.feature_flags set rollout = '{"rejected_days": 5, "inactive_days": 365}' where key = 'kyc_retention'`,
    );
    expect(await due()).toEqual([`${rider}/new.jpg`]);
    await db().query(`update public.feature_flags set enabled = false where key = 'kyc_retention'`);
    expect(await due()).toEqual([]);
  });

  it("records job runs and requires a result once finished", async () => {
    const { rows } = await db().query<{ id: string }>(
      `insert into public.job_runs (job) values ('background') returning id`,
    );
    expect(
      await failureOf(db(), () =>
        db().query("update public.job_runs set finished_at = now() where id = $1", [rows[0]?.id]),
      ),
    ).toMatch(/job_runs_finished/);
    await db().query(
      `update public.job_runs set finished_at = now(), ok = true, summary = '{"dispatched": 1}' where id = $1`,
      [rows[0]?.id],
    );
  });

  it("seeds the resilience switches with safe defaults", async () => {
    const { rows } = await db().query<{ key: string; enabled: boolean }>(
      `select key, enabled from public.feature_flags
        where key in ('online_payments', 'flat_delivery_fee', 'kyc_retention') order by key`,
    );
    expect(rows).toEqual([
      { key: "flat_delivery_fee", enabled: false },
      { key: "kyc_retention", enabled: true },
      { key: "online_payments", enabled: true },
    ]);
  });
});
