import { expect, it } from "vitest";
import { describeDb, useRollbackTransaction } from "./support";

describeDb("seed data (supabase/seed.sql)", () => {
  const { db } = useRollbackTransaction();

  it("has one placeholder pilot zone that serves its own centre", async () => {
    const { rows } = await db().query<{ slug: string; name: string; served: boolean }>(
      `select z.slug, z.name,
              (select id from public.zone_for_point(extensions.st_centroid(z.area::extensions.geometry)::extensions.geography)) = z.id as served
       from public.zones z where z.slug = 'pilot-zone'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toMatch(/placeholder/i);
    expect(rows[0]?.served).toBe(true);
  });

  it("has 5 live merchants inside the pilot zone, each with a menu and options", async () => {
    const { rows } = await db().query<{
      name: string;
      items: number;
      groups: number;
      inside: boolean;
    }>(
      `select m.name,
              (select count(*)::int from public.menu_items i where i.merchant_id = m.id) as items,
              (select count(*)::int from public.modifier_groups g join public.menu_items i on i.id = g.menu_item_id where i.merchant_id = m.id) as groups,
              extensions.st_covers(z.area, m.location) as inside
       from public.merchants m join public.zones z on z.id = m.zone_id
       where z.slug = 'pilot-zone' and m.status = 'active' order by m.name`,
    );
    expect(rows).toHaveLength(5);
    for (const merchant of rows) {
      expect(merchant.items, merchant.name).toBeGreaterThanOrEqual(4);
      expect(merchant.groups, merchant.name).toBeGreaterThanOrEqual(1);
      expect(merchant.inside, merchant.name).toBe(true);
    }
  });

  it("has 3 riders: two approved, one waiting for KYC", async () => {
    const { rows } = await db().query<{ status: string; count: number }>(
      `select r.status::text, count(*)::int from public.riders r join public.zones z on z.id = r.zone_id
       where z.slug = 'pilot-zone' group by 1 order by 1`,
    );
    expect(rows).toEqual([
      { status: "active", count: 2 },
      { status: "pending_kyc", count: 1 },
    ]);
  });

  it("has test customers, a coordinator for the pilot zone, and an admin", async () => {
    const { rows } = await db().query<{ role: string; count: number }>(
      `select role::text, count(distinct user_id)::int from public.user_roles
       where user_id in (select id from auth.users where email like '%@seed.klikgo.test') group by 1 order by 1`,
    );
    const counts = Object.fromEntries(rows.map((r) => [r.role, r.count]));
    expect(counts.admin).toBe(1);
    expect(counts.coordinator).toBe(1);
    expect(counts.merchant_owner).toBe(5);
    expect(counts.rider).toBe(3);
    expect(counts.customer).toBeGreaterThanOrEqual(3);
  });

  it("stores every seeded price as whole centavos above zero", async () => {
    const { rows } = await db().query<{ bad: number }>(
      `select count(*)::int as bad from public.menu_items where price_centavos <= 0`,
    );
    expect(rows[0]?.bad).toBe(0);
  });
});
