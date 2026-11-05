import { randomUUID } from "node:crypto";
import { getPrismaClient } from "@klikgo/db";
import { afterAll, describe, expect, it } from "vitest";
import {
  PrismaAddressRepository,
  PrismaCatalogRepository,
  PrismaSearchRepository,
  PrismaServiceArea,
  PrismaWaitlistRepository,
} from "./prisma-catalog-repository";

if (process.env.CI && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set in CI for repository tests.");
}
const describeDb = describe.skipIf(!process.env.DATABASE_URL);

const AYALA = { lat: 14.5547, lng: 121.0244 };
const PASIG = { lat: 14.5707, lng: 121.0596 };

/** Discovery repositories against the seeded local database (`pnpm db:reset`). */
describeDb("catalog repositories (local Supabase, seed data)", () => {
  const prisma = getPrismaClient();
  const area = new PrismaServiceArea(prisma);
  const catalog = new PrismaCatalogRepository(prisma);
  const search = new PrismaSearchRepository(prisma);
  const cleanup: (() => Promise<unknown>)[] = [];

  afterAll(async () => {
    for (const step of cleanup.reverse()) await step();
    await prisma.$disconnect();
  });

  async function makati(): Promise<string> {
    const zone = await area.zoneFor(AYALA);
    if (!zone) throw new Error("Makati zone missing (pnpm db:reset)");
    return zone.id;
  }

  it("serves Ayala Avenue from Makati and nothing in Pasig", async () => {
    expect((await area.zoneFor(AYALA))?.slug).toBe("makati");
    expect(await area.zoneFor(PASIG)).toBeNull();
  });

  it("reads Makati's live stores with hours, radius, cheapest item and fees", async () => {
    const zoneId = await makati();
    const stores = await catalog.storesInZone(zoneId);
    const kape = stores.find((s) => s.name === "Kape't Tinapay");
    expect(stores).toHaveLength(5);
    expect(kape).toMatchObject({ radiusKm: 8, minItemPriceCentavos: 3500, prepMinutes: 15 });
    expect(kape?.hours.mon.length).toBeGreaterThan(0);
    const fees = await catalog.zoneFees(zoneId);
    expect(fees.rules.filter((r) => r.kind === "delivery_distance_band")).toHaveLength(3);
    const promos = await catalog.featuredPromos(zoneId, new Date());
    expect(promos.map((p) => p.code).sort()).toEqual(["KAINTAYO", "LIBREHATID"]);
    expect(await catalog.recentMerchantIds(randomUUID(), 5)).toEqual([]);
  });

  it("loads items, choices and fees for pricing, and nothing for unknown stores", async () => {
    const kape = (await catalog.storesInZone(await makati())).find(
      (s) => s.name === "Kape't Tinapay",
    );
    const item = await prisma.menu_items.findFirstOrThrow({
      where: { merchant_id: kape?.merchantId ?? "", name: "Kapeng Barako" },
    });
    const quote = await catalog.loadForQuote(kape?.merchantId ?? "", [item.id]);
    expect(quote?.merchant.name).toBe("Kape't Tinapay");
    expect(quote?.items[0]?.groups[0]).toMatchObject({ name: "Sugar", required: true });
    expect(quote?.items[0]?.groups[0]?.options.map((o) => o.name).sort()).toEqual([
      "Less sugar",
      "No sugar",
      "Regular",
    ]);
    expect(await catalog.loadForQuote(randomUUID(), [])).toBeNull();
  });

  it("finds dishes by word and stores despite a typo", async () => {
    const zoneId = await makati();
    const adobo = await search.search(zoneId, "adobo");
    expect(adobo.dishes.map((d) => d.name)).toContain("Adobong Manok");
    const typo = await search.search(zoneId, "kape tinapy");
    expect(typo.stores.length).toBeGreaterThan(0);
    expect(await search.search(zoneId, "zzzzqqqq")).toEqual({ stores: [], dishes: [] });
  });

  it("records waitlist sign-ups", async () => {
    const saved = await new PrismaWaitlistRepository(prisma).add({
      name: "Repo Test",
      phone: "+639175550199",
      email: null,
      barangay: "Kapitolyo",
      city: "Pasig City",
      location: PASIG,
    });
    cleanup.push(() => prisma.waitlist_signups.delete({ where: { id: saved.id } }));
    expect((await prisma.waitlist_signups.findUnique({ where: { id: saved.id } }))?.barangay).toBe(
      "Kapitolyo",
    );
  });

  it("keeps one default address per customer", async () => {
    const userId = randomUUID();
    await prisma.$executeRaw`
      insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
      values (${userId}::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              ${`${userId.slice(0, 8)}@example.test`}, now(), now())`;
    cleanup.push(() => prisma.$executeRaw`delete from auth.users where id = ${userId}::uuid`);
    const addresses = new PrismaAddressRepository(prisma);
    const base = {
      location: AYALA,
      street: null,
      landmark: "Beside the 7-Eleven",
      barangay: "San Lorenzo",
      city: "Makati City",
      notes: null,
      contactPhone: "+639170000103",
      isDefault: true,
    };
    await addresses.create(userId, { ...base, label: "Office" });
    await addresses.create(userId, { ...base, label: "Home" });
    const list = await addresses.listFor(userId);
    expect(list.map((a) => [a.label, a.isDefault])).toEqual([
      ["Home", true],
      ["Office", false],
    ]);
    expect(list[0]?.location.lat).toBeCloseTo(AYALA.lat, 6);
  });
});
