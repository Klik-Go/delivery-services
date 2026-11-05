import { expect, it } from "vitest";
import { describeDb, useRollbackTransaction } from "./support";

describeDb("seed data (supabase/seed.sql)", () => {
  const { db } = useRollbackTransaction();

  it("has the three launch zones, and Makati serves a point inside it", async () => {
    const zones = await db().query<{ slug: string; zone_type: string; is_active: boolean }>(
      `select slug, zone_type::text, is_active from public.zones
       where slug in ('makati', 'san-fernando-pampanga', 'san-marcelino-zambales') order by slug`,
    );
    expect(zones.rows).toEqual([
      { slug: "makati", zone_type: "city", is_active: true },
      { slug: "san-fernando-pampanga", zone_type: "city", is_active: true },
      { slug: "san-marcelino-zambales", zone_type: "provincial", is_active: true },
    ]);
    const { rows } = await db().query<{ slug: string; name: string; served: boolean }>(
      `select z.slug, z.name,
              (select id from public.zone_for_point(extensions.st_pointonsurface(z.area::extensions.geometry)::extensions.geography)) = z.id as served
       from public.zones z where z.slug = 'makati'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Makati City");
    expect(rows[0]?.served).toBe(true);
  });

  it("serves Ayala Avenue, San Fernando and San Marcelino, but not Pembo (Taguig since the EMBO ruling)", async () => {
    const { rows } = await db().query<{ place: string; zone: string | null }>(
      `select place, (select z.slug from public.zone_for_point(
                extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography) f
              join public.zones z on z.id = f.id) as zone
       from (values ('Ayala Avenue', 121.0244, 14.5547), ('Pembo', 121.0640, 14.5435),
                    ('San Fernando city hall', 120.6869, 15.0286), ('San Marcelino poblacion', 120.1590, 14.9740),
                    ('Angeles City', 120.5887, 15.1450)) t(place, lng, lat)`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.place, r.zone]))).toEqual({
      "Ayala Avenue": "makati",
      Pembo: null,
      "San Fernando city hall": "san-fernando-pampanga",
      "San Marcelino poblacion": "san-marcelino-zambales",
      "Angeles City": null,
    });
  });

  it("has 5 live merchants inside Makati, each with a menu and options", async () => {
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
       where z.slug = 'makati' and m.status = 'active' order by m.name`,
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
       where z.slug = 'makati' group by 1 order by 1`,
    );
    expect(rows).toEqual([
      { status: "active", count: 2 },
      { status: "pending_kyc", count: 1 },
    ]);
  });

  it("has test customers, a coordinator for Makati, and an admin", async () => {
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
