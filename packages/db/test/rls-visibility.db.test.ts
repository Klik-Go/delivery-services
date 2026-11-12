import { beforeEach, expect, it } from "vitest";
import { asUser } from "../src/testing";
import { describeDb, failureOf, ids, useRollbackTransaction } from "./support";
import { buildWorld, type World } from "./world";

type Viewer = keyof World["users"] | "anon";

describeDb("row-level security: who can see which rows", () => {
  const { db, fx } = useRollbackTransaction();
  let w: World;

  beforeEach(async () => {
    w = await buildWorld(db(), fx());
  });

  /** Ids of rows visible to `viewer`, restricted to this test's world (seed rows are ignored). */
  async function seen(viewer: Viewer, sql: string, params: unknown[] = []): Promise<string[]> {
    const userId = viewer === "anon" ? null : w.users[viewer];
    return asUser(db(), userId, () => ids(db(), sql, params));
  }
  const sorted = (...values: string[]): string[] => [...values].sort();

  it("orders: customers see their own, merchants their store's, riders offered/assigned, coordinators their zone", async () => {
    const all = [w.order1, w.order2, w.order3, w.order4];
    const q = `select id from public.orders where id = any($1)`;
    expect(await seen("customer1", q, [all])).toEqual(sorted(w.order1, w.order4));
    expect(await seen("customer2", q, [all])).toEqual(sorted(w.order2, w.order3));
    expect(await seen("ownerA", q, [all])).toEqual(sorted(w.order1, w.order3, w.order4));
    expect(await seen("staffA", q, [all])).toEqual(sorted(w.order1, w.order3, w.order4));
    expect(await seen("ownerB", q, [all])).toEqual(sorted(w.order2));
    expect(await seen("riderA1", q, [all])).toEqual(sorted(w.order1, w.order4));
    expect(await seen("riderA2", q, [all])).toEqual(sorted(w.order3));
    expect(await seen("riderB", q, [all])).toEqual([]);
    expect(await seen("coordA", q, [all])).toEqual(sorted(w.order1, w.order3, w.order4));
    expect(await seen("coordB", q, [all])).toEqual(sorted(w.order2));
    expect(await seen("admin", q, [all])).toEqual(sorted(...all));
    expect(await seen("anon", q, [all])).toEqual([]);
  });

  it("a delivery PIN is seen only by the order's customer: not the rider, store or other customers", async () => {
    const q = "select order_id as id from public.order_delivery_pins where order_id = any($1)";
    const both = [[w.order1, w.order2]];
    expect(await seen("customer1", q, both)).toEqual([w.order1]);
    expect(await seen("customer2", q, both)).toEqual([w.order2]);
    // Anonymous visitors have no grant on the table at all.
    for (const viewer of ["riderA1", "ownerA", "staffA", "coordA"] as const) {
      expect(await seen(viewer, q, both)).toEqual([]);
    }
  });

  it("support notes are seen by the order's zone coordinator and admins only", async () => {
    const q =
      "select distinct order_id as id from public.order_support_notes where order_id = any($1)";
    const both = [[w.order1, w.order2]];
    expect(await seen("coordA", q, both)).toEqual([w.order1]);
    expect(await seen("coordB", q, both)).toEqual([w.order2]);
    expect(await seen("admin", q, both)).toEqual(sorted(w.order1, w.order2));
    // Anonymous visitors have no grant on the table at all.
    for (const viewer of ["customer1", "customer2", "riderA1", "ownerA", "staffA"] as const) {
      expect(await seen(viewer, q, both), viewer).toEqual([]);
    }
  });

  it("order items, events, payments and refunds follow the order they belong to", async () => {
    for (const table of ["order_items", "order_events", "payments", "refunds"]) {
      const q = `select distinct order_id as id from public.${table} where order_id = any($1)`;
      const pair = [w.order1, w.order2];
      expect(await seen("customer1", q, [pair]), table).toEqual([w.order1]);
      expect(await seen("customer2", q, [pair]), table).toEqual([w.order2]);
      expect(await seen("anon", q, [pair]), table).toEqual([]);
      expect(await seen("admin", q, [pair]), table).toEqual(sorted(w.order1, w.order2));
    }
  });

  it("order events are visible to the merchant and rider of the order, not to other stores", async () => {
    const q = `select distinct order_id as id from public.order_events where order_id = any($1)`;
    expect(await seen("ownerB", q, [[w.order1, w.order2]])).toEqual([w.order2]);
    expect(await seen("riderA1", q, [[w.order1, w.order2]])).toEqual([w.order1]);
  });

  it("dispatch offers: a rider sees only their own offers", async () => {
    const q = `select order_id as id from public.dispatch_offers where order_id = any($1)`;
    const all = [w.order1, w.order3, w.order4];
    expect(await seen("riderA1", q, [all])).toEqual(sorted(w.order1, w.order4));
    expect(await seen("riderA2", q, [all])).toEqual([w.order3]);
    expect(await seen("customer1", q, [all])).toEqual([]);
    expect(await seen("coordA", q, [all])).toEqual(sorted(...all));
  });

  it("addresses: only the owner (and admins) can see a saved address", async () => {
    const q = `select user_id as id from public.addresses where user_id = any($1)`;
    const both = [w.users.customer1, w.users.customer2];
    expect(await seen("customer1", q, [both])).toEqual([w.users.customer1]);
    expect(await seen("customer2", q, [both])).toEqual([w.users.customer2]);
    expect(await seen("ownerA", q, [both])).toEqual([]);
    expect(await seen("anon", q, [both])).toEqual([]);
    expect(await seen("admin", q, [both])).toEqual(sorted(...both));
  });

  it("profiles: people see their own; coordinators see riders in their zone; admins see all", async () => {
    const q = `select id from public.profiles where id = any($1)`;
    const people = [w.users.customer1, w.users.customer2, w.users.riderA1, w.users.riderB];
    expect(await seen("customer1", q, [people])).toEqual([w.users.customer1]);
    expect(await seen("coordA", q, [people])).toEqual([w.users.riderA1]);
    expect(await seen("anon", q, [people])).toEqual([]);
    expect(await seen("admin", q, [people])).toEqual(sorted(...people));
  });

  it("user roles: people see their own roles; admins see everyone's", async () => {
    const q = `select distinct user_id as id from public.user_roles where user_id = any($1)`;
    const people = [w.users.customer1, w.users.ownerA];
    expect(await seen("customer1", q, [people])).toEqual([w.users.customer1]);
    expect(await seen("admin", q, [people])).toEqual(sorted(...people));
  });

  it("invites: a merchant owner sees invites to their store; customers see none", async () => {
    const q = `select merchant_id as id from public.invites where merchant_id = any($1)`;
    expect(await seen("ownerA", q, [[w.merchantA]])).toEqual([w.merchantA]);
    expect(await seen("staffA", q, [[w.merchantA]])).toEqual([]);
    expect(await seen("customer1", q, [[w.merchantA]])).toEqual([]);
    expect(await seen("admin", q, [[w.merchantA]])).toEqual([w.merchantA]);
  });

  it("zones: everyone sees active zones; paused zones only admins", async () => {
    const q = `select id from public.zones where id = any($1)`;
    const zones = [w.zoneA, w.zoneB, w.pausedZone];
    expect(await seen("anon", q, [zones])).toEqual(sorted(w.zoneA, w.zoneB));
    expect(await seen("customer1", q, [zones])).toEqual(sorted(w.zoneA, w.zoneB));
    expect(await seen("admin", q, [zones])).toEqual(sorted(...zones));
  });

  it("merchants and menus: live stores are public; a pending store only its team and admins", async () => {
    const merchants = [w.merchantA, w.merchantB, w.pendingMerchant];
    const queries = {
      merchants: `select id from public.merchants where id = any($1)`,
      menu_categories: `select distinct merchant_id as id from public.menu_categories where merchant_id = any($1)`,
      menu_items: `select distinct merchant_id as id from public.menu_items where merchant_id = any($1)`,
      modifier_groups: `select distinct i.merchant_id as id from public.modifier_groups g join public.menu_items i on i.id = g.menu_item_id where i.merchant_id = any($1)`,
      modifier_options: `select distinct i.merchant_id as id from public.modifier_options o join public.modifier_groups g on g.id = o.modifier_group_id join public.menu_items i on i.id = g.menu_item_id where i.merchant_id = any($1)`,
    };
    for (const [table, q] of Object.entries(queries)) {
      expect(await seen("anon", q, [merchants]), table).toEqual(sorted(w.merchantA, w.merchantB));
      expect(await seen("customer1", q, [merchants]), table).toEqual(
        sorted(w.merchantA, w.merchantB),
      );
      expect(await seen("ownerB", q, [merchants]), table).toEqual(sorted(...merchants));
      expect(await seen("admin", q, [merchants]), table).toEqual(sorted(...merchants));
    }
  });

  it("riders: a rider sees themself; coordinators their zone; a customer the rider delivering to them", async () => {
    const q = `select id from public.riders where id = any($1)`;
    const riders = [w.riders.A1, w.riders.A2, w.riders.B];
    expect(await seen("riderA1", q, [riders])).toEqual([w.riders.A1]);
    expect(await seen("coordA", q, [riders])).toEqual(sorted(w.riders.A1, w.riders.A2));
    expect(await seen("coordB", q, [riders])).toEqual([w.riders.B]);
    expect(await seen("customer1", q, [riders])).toEqual([w.riders.A1]);
    expect(await seen("customer2", q, [riders])).toEqual([]);
    expect(await seen("anon", q, [riders])).toEqual([]);
  });

  it("rider locations: shared only with the rider, their coordinator, and the customer they are delivering to", async () => {
    const q = `select rider_id as id from public.rider_locations where rider_id = any($1)`;
    const riders = [w.riders.A1, w.riders.A2, w.riders.B];
    expect(await seen("riderA1", q, [riders])).toEqual([w.riders.A1]);
    expect(await seen("customer1", q, [riders])).toEqual([w.riders.A1]);
    expect(await seen("customer2", q, [riders])).toEqual([]);
    expect(await seen("coordA", q, [riders])).toEqual(sorted(w.riders.A1, w.riders.A2));
    expect(await seen("ownerA", q, [riders])).toEqual([]);
  });

  it("location breadcrumbs: rider, zone coordinator and admins only (never customers)", async () => {
    const q = `select distinct rider_id as id from public.rider_location_breadcrumbs where rider_id = any($1)`;
    const riders = [w.riders.A1, w.riders.B];
    expect(await seen("riderA1", q, [riders])).toEqual([w.riders.A1]);
    expect(await seen("coordA", q, [riders])).toEqual([w.riders.A1]);
    expect(await seen("customer1", q, [riders])).toEqual([]);
    expect(await seen("admin", q, [riders])).toEqual(sorted(...riders));
  });

  it("rider KYC documents: admins only; not the coordinator, other riders, or customers", async () => {
    const q = `select rider_id as id from public.rider_kyc_documents where rider_id = any($1)`;
    const riders = [w.riders.A1, w.riders.B];
    expect(await seen("admin", q, [riders])).toEqual(sorted(...riders));
    for (const viewer of ["riderA1", "riderB", "coordA", "customer1", "anon"] as const) {
      expect(await seen(viewer, q, [riders]), viewer).toEqual([]);
    }
  });

  it("ledger and payouts: each party sees its own money; admins see all", async () => {
    const ledger = `select distinct party_id as id from public.ledger_entries where party_id = any($1)`;
    const parties = [w.merchantA, w.merchantB, w.riders.A1, w.riders.B];
    expect(await seen("ownerA", ledger, [parties])).toEqual([w.merchantA]);
    expect(await seen("riderA1", ledger, [parties])).toEqual([w.riders.A1]);
    expect(await seen("customer1", ledger, [parties])).toEqual([]);
    expect(await seen("admin", ledger, [parties])).toEqual(sorted(...parties));

    const payouts = `select party_id as id from public.payouts where party_id = any($1)`;
    expect(await seen("ownerA", payouts, [[w.merchantA, w.merchantB]])).toEqual([w.merchantA]);
    expect(await seen("staffA", payouts, [[w.merchantA, w.merchantB]])).toEqual([]);
    expect(await seen("customer1", payouts, [[w.merchantA, w.merchantB]])).toEqual([]);
  });

  it("webhook events are server-only: not even admins read them through the API", async () => {
    const q = `select event_id as id from public.webhook_events where event_id = 'evt_test_1'`;
    expect(await seen("admin", q)).toEqual([]);
    expect(await seen("customer1", q)).toEqual([]);
  });

  it("ratings: the author and the rated store see a rating; others do not", async () => {
    const q = `select order_id as id from public.ratings where order_id = $1`;
    expect(await seen("customer1", q, [w.order1])).toEqual([w.order1]);
    expect(await seen("ownerA", q, [w.order1])).toEqual([w.order1]);
    expect(await seen("customer2", q, [w.order1])).toEqual([]);
    expect(await seen("ownerB", q, [w.order1])).toEqual([]);
  });

  it("promos stay private (codes are validated by the server); redemptions only by their user", async () => {
    expect(
      await seen("customer1", `select id from public.promos where code like 'BAGONG%'`),
    ).toEqual([]);
    expect(
      await seen("admin", `select id from public.promos where code like 'BAGONG%'`),
    ).toHaveLength(1);
    const q = `select user_id as id from public.promo_redemptions where order_id = $1`;
    expect(await seen("customer1", q, [w.order1])).toEqual([w.users.customer1]);
    expect(await seen("customer2", q, [w.order1])).toEqual([]);
  });

  it("referrals: visible to the referrer and the referred friend only", async () => {
    const q = `select referrer_id as id from public.referrals where referrer_id = $1`;
    expect(await seen("customer1", q, [w.users.customer1])).toEqual([w.users.customer1]);
    expect(await seen("customer2", q, [w.users.customer1])).toEqual([w.users.customer1]);
    expect(await seen("ownerA", q, [w.users.customer1])).toEqual([]);
  });

  it("loyalty stamps, push subscriptions and notifications belong to one person", async () => {
    for (const [table, column] of [
      ["loyalty_stamps", "customer_id"],
      ["device_push_subscriptions", "user_id"],
      ["notifications", "user_id"],
    ] as const) {
      const q = `select ${column} as id from public.${table} where ${column} = $1`;
      expect(await seen("customer1", q, [w.users.customer1]), table).toEqual([w.users.customer1]);
      expect(await seen("customer2", q, [w.users.customer1]), table).toEqual([]);
      expect(await seen("anon", q, [w.users.customer1]), table).toEqual([]);
    }
  });

  it("audit logs: admins only", async () => {
    const q = `select actor_id as id from public.audit_logs where actor_id = $1`;
    expect(await seen("admin", q, [w.users.admin])).toEqual([w.users.admin]);
    expect(await seen("coordA", q, [w.users.admin])).toEqual([]);
    expect(await seen("customer1", q, [w.users.admin])).toEqual([]);
  });

  it("fee rules are public for live zones; feature flags readable when signed in", async () => {
    const fees = `select zone_id as id from public.fee_rules where zone_id = any($1)`;
    expect(await seen("anon", fees, [[w.zoneA, w.pausedZone]])).toEqual([w.zoneA]);
    expect(await seen("admin", fees, [[w.zoneA, w.pausedZone]])).toEqual(
      sorted(w.zoneA, w.pausedZone),
    );
    const flags = `select key as id from public.feature_flags where key = 'pabili_mode_test'`;
    expect(await seen("customer1", flags)).toEqual(["pabili_mode_test"]);
    expect(await seen("anon", flags)).toEqual([]);
  });

  it("merchant applications: admins see all; coordinators their zone; nobody else", async () => {
    const all = Object.values(w.applications);
    const q = `select id from public.merchant_applications where id = any($1)`;
    expect(await seen("admin", q, [all])).toEqual(sorted(...all));
    expect(await seen("coordA", q, [all])).toEqual([w.applications.A]);
    expect(await seen("coordB", q, [all])).toEqual([w.applications.B]);
    for (const viewer of ["ownerA", "staffA", "customer1", "riderA1"] as const)
      expect(await seen(viewer, q, [all]), viewer).toEqual([]);
    // Anonymous visitors have no grant at all on applications (applicants' contact details).
    const anon = await asUser(db(), null, () => failureOf(db(), () => db().query(q, [all])));
    expect(anon).toMatch(/permission denied/);
  });

  it("holiday closures follow their store: public for live stores, team-only while pending", async () => {
    const q = `select merchant_id as id from public.merchant_closures where merchant_id = any($1)`;
    const both = [w.merchantA, w.pendingMerchant];
    expect(await seen("anon", q, [both])).toEqual([w.merchantA]);
    expect(await seen("customer1", q, [both])).toEqual([w.merchantA]);
    expect(await seen("ownerB", q, [both])).toEqual(sorted(w.merchantA, w.pendingMerchant));
    expect(await seen("admin", q, [both])).toEqual(sorted(w.merchantA, w.pendingMerchant));
  });

  it("waitlist signups: admins only; anonymous visitors have no access at all", async () => {
    const q = `select id from public.waitlist_signups where phone = '+639170000998'`;
    expect(await seen("admin", q)).toHaveLength(1);
    for (const viewer of ["customer1", "ownerA", "coordA", "riderA1"] as const)
      expect(await seen(viewer, q), viewer).toEqual([]);
    const anon = await asUser(db(), null, () => failureOf(db(), () => db().query(q)));
    expect(anon).toMatch(/permission denied/);
  });
});
