import { beforeEach, expect, it } from "vitest";
import { type LatLng, offsetLatLng, pointEwkt } from "../src/testing";
import { describeDb, failureOf, useRollbackTransaction } from "./support";

const CENTRE: LatLng = { lat: 7.0731, lng: 125.6128 };

describeDb("PostGIS: zones and nearest riders", () => {
  const { db, fx } = useRollbackTransaction();
  let zone: string;

  beforeEach(async () => {
    zone = await fx().zone({ name: "Geo Test", centre: CENTRE, halfSizeM: 2000 });
  });

  async function zoneFor(point: LatLng): Promise<string | null> {
    const { rows } = await db().query<{ id: string }>(
      `select id from public.zone_for_point($1::extensions.geography)`,
      [pointEwkt(point)],
    );
    return rows[0]?.id ?? null;
  }

  it("finds the zone that contains a point", async () => {
    expect(await zoneFor(CENTRE)).toBe(zone);
    expect(await zoneFor(offsetLatLng(CENTRE, 1500, -1500))).toBe(zone);
  });

  it("returns no zone for a point outside every zone", async () => {
    expect(await zoneFor(offsetLatLng(CENTRE, 50_000))).toBeNull();
  });

  it("ignores paused zones", async () => {
    await db().query(`update public.zones set is_active = false where id = $1`, [zone]);
    expect(await zoneFor(CENTRE)).toBeNull();
  });

  it("prefers the smaller zone where two zones overlap (a barangay inside a city)", async () => {
    const inner = await fx().zone({ name: "Inner", centre: CENTRE, halfSizeM: 500 });
    expect(await zoneFor(CENTRE)).toBe(inner);
  });

  it("rejects a zone whose radius is outside its type's band (docs/BUSINESS.md §5.5)", async () => {
    const err = await failureOf(db(), () =>
      db().query(`update public.zones set max_radius_km = 12 where id = $1`, [zone]),
    );
    expect(err).toMatch(/zones_radius_matches_type/);
  });

  it("rejects a merchant located outside its zone", async () => {
    const owner = await fx().user("Far Owner");
    const err = await failureOf(db(), () =>
      fx().merchant({
        zoneId: zone,
        ownerId: owner,
        name: "Too Far",
        location: offsetLatLng(CENTRE, 40_000),
      }),
    );
    expect(err).toMatch(/outside its zone/);
  });

  describeNearest();

  function describeNearest(): void {
    async function riderAt(
      name: string,
      northM: number,
      options: {
        status?: "active" | "pending_kyc";
        isOnline?: boolean;
        lastSeenSecondsAgo?: number;
      } = {},
    ) {
      const user = await fx().user(name);
      return fx().rider({
        userId: user,
        zoneId: zone,
        status: options.status ?? "active",
        isOnline: options.isOnline ?? true,
        location: offsetLatLng(CENTRE, northM),
        lastSeenSecondsAgo: options.lastSeenSecondsAgo ?? 5,
      });
    }

    async function nearest(limit: number, maxDistanceM = 5000): Promise<string[]> {
      const { rows } = await db().query<{ rider_id: string; distance_m: number }>(
        `select rider_id, distance_m from public.nearest_available_riders($1::extensions.geography, $2, $3)`,
        [pointEwkt(CENTRE), limit, maxDistanceM],
      );
      const distances = rows.map((r) => Number(r.distance_m));
      expect(distances).toEqual([...distances].sort((a, b) => a - b));
      return rows.map((r) => r.rider_id);
    }

    it("lists available riders nearest first, up to the limit", async () => {
      const ana = await riderAt("Ana", 800);
      const ben = await riderAt("Ben", 300);
      const carlo = await riderAt("Carlo", 1500);
      expect(await nearest(3)).toEqual([ben, ana, carlo]);
      expect(await nearest(2)).toEqual([ben, ana]);
    });

    it("skips riders beyond the search radius", async () => {
      const ben = await riderAt("Ben", 300);
      await riderAt("Far", 3000);
      expect(await nearest(5, 1000)).toEqual([ben]);
    });

    it("skips riders who are offline, not yet approved, silent for over 2 minutes, or already delivering", async () => {
      const ben = await riderAt("Ben", 300);
      await riderAt("Offline", 100, { isOnline: false });
      await riderAt("New", 50, { status: "pending_kyc", isOnline: false });
      await riderAt("Stale", 120, { lastSeenSecondsAgo: 600 });
      const busy = await riderAt("Busy", 150);
      const owner = await fx().user("Owner");
      const customer = await fx().user("Customer");
      const merchant = await fx().merchant({
        zoneId: zone,
        ownerId: owner,
        name: "Shop",
        location: CENTRE,
      });
      const order = await fx().order({
        customerId: customer,
        merchantId: merchant,
        zoneId: zone,
        dropoff: offsetLatLng(CENTRE, 400),
      });
      await fx().assignRider(order, busy);
      await fx().setStatus(order, "accepted");
      expect(await nearest(10)).toEqual([ben]);
    });

    it("frees a rider again once their delivery is completed", async () => {
      const busy = await riderAt("Busy", 150);
      const owner = await fx().user("Owner");
      const customer = await fx().user("Customer");
      const merchant = await fx().merchant({
        zoneId: zone,
        ownerId: owner,
        name: "Shop",
        location: CENTRE,
      });
      const order = await fx().order({
        customerId: customer,
        merchantId: merchant,
        zoneId: zone,
        dropoff: offsetLatLng(CENTRE, 400),
      });
      await fx().assignRider(order, busy);
      for (const s of ["accepted", "preparing", "ready", "picked_up", "delivered"] as const)
        await fx().setStatus(order, s);
      expect(await nearest(10)).toEqual([busy]);
    });
  }
});
