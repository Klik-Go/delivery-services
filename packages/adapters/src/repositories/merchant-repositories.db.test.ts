import { randomUUID } from "node:crypto";
import { getPrismaClient } from "@klikgo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaMenuRepository } from "./prisma-menu-repository";
import {
  PrismaMerchantApplicationRepository,
  PrismaZoneLocator,
} from "./prisma-merchant-application-repository";
import { PrismaStoreRepository } from "./prisma-store-repository";

// In CI these tests must run, never silently skip.
if (process.env.CI && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set in CI for repository tests.");
}
const describeDb = describe.skipIf(!process.env.DATABASE_URL);

/** Ayala Avenue (inside the Makati launch zone) and Cebu (outside every zone). */
const PILOT = { lat: 14.5547, lng: 121.0244 };
const CEBU = { lat: 10.3157, lng: 123.8854 };

/**
 * Repositories against the real local Supabase database (`pnpm db:reset`). Prisma commits, so each
 * test creates its own rows with unique names and the afterAll hook deletes them again.
 */
describeDb("merchant repositories (local Supabase)", () => {
  const prisma = getPrismaClient();
  const applications = new PrismaMerchantApplicationRepository(prisma);
  const zones = new PrismaZoneLocator(prisma);
  const stores = new PrismaStoreRepository(prisma);
  const menus = new PrismaMenuRepository(prisma);
  const tag = randomUUID().slice(0, 8);
  const createdUsers: string[] = [];
  const createdMerchants: string[] = [];
  const createdApplications: string[] = [];
  let admin: string;

  async function user(): Promise<string> {
    const id = randomUUID();
    await prisma.$executeRaw`
      insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
      values (${id}::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              ${`${id.slice(0, 8)}-${tag}@example.test`}, now(), now())`;
    createdUsers.push(id);
    return id;
  }

  async function newApplication(name: string, at = PILOT): Promise<string> {
    const zone = await zones.zoneAt(at);
    const { id } = await applications.create({
      businessName: name,
      ownerName: "Test Owner",
      phone: "+639175550101",
      email: `${name.toLowerCase().replace(/\W+/g, "-")}@example.test`,
      category: "food",
      barangay: "Poblacion",
      city: "Placeholder City",
      addressLine: null,
      location: at,
      zoneId: zone?.id ?? null,
    });
    createdApplications.push(id);
    return id;
  }

  async function approved(name: string): Promise<{ merchantId: string; slug: string }> {
    const result = await applications.approve({
      applicationId: await newApplication(name),
      reviewerId: admin,
      ownerId: await user(),
      slug: `repo-test-${tag}`,
      commissionBps: 2000,
      foundingCommissionUntil: new Date(Date.now() + 90 * 86_400_000),
      invite: {
        email: `owner-${tag}@example.test`,
        tokenHash: randomUUID(),
        expiresAt: new Date(),
      },
    });
    if (!result) throw new Error("approval failed");
    createdMerchants.push(result.merchantId);
    return result;
  }

  beforeAll(async () => {
    admin = await user();
  });

  afterAll(async () => {
    await prisma.merchant_applications.deleteMany({ where: { id: { in: createdApplications } } });
    await prisma.invites.deleteMany({ where: { merchant_id: { in: createdMerchants } } });
    await prisma.merchants.deleteMany({ where: { id: { in: createdMerchants } } });
    // audit_logs is append-only by design; its rows stay.
    await prisma.$executeRaw`delete from auth.users where id = any(${createdUsers}::uuid[])`;
    await prisma.$disconnect();
  });

  it("finds the zone that covers a pin, or none", async () => {
    expect((await zones.zoneAt(PILOT))?.name).toBe("Makati City");
    expect(await zones.zoneAt(CEBU)).toBeNull();
  });

  it("stores applications with their pin and lists them by status and zone", async () => {
    const inside = await newApplication(`Inside ${tag}`);
    const outside = await newApplication(`Outside ${tag}`, CEBU);
    const pilot = await zones.zoneAt(PILOT);

    const found = await applications.findById(inside);
    const all = await applications.list({ status: "pending", zoneIds: null });
    const pilotOnly = await applications.list({ status: "pending", zoneIds: [pilot?.id ?? ""] });

    expect(found).toMatchObject({
      businessName: `Inside ${tag}`,
      zoneName: "Makati City",
      status: "pending",
    });
    expect(found?.location.lat).toBeCloseTo(PILOT.lat, 6);
    expect(all.map((a) => a.id)).toEqual(expect.arrayContaining([inside, outside]));
    expect(pilotOnly.map((a) => a.id)).toContain(inside);
    expect(pilotOnly.map((a) => a.id)).not.toContain(outside);
    expect(await applications.findById(randomUUID())).toBeNull();
  });

  it("approves in one transaction: closed active store, owner role, hashed invite, audit row", async () => {
    const first = await approved(`Approve ${tag}`);
    const second = await approved(`Approve again ${tag}`);

    expect(first.slug).toBe(`repo-test-${tag}`);
    expect(second.slug).toBe(`repo-test-${tag}-2`);
    const merchant = await prisma.merchants.findUniqueOrThrow({
      where: { id: first.merchantId },
      include: { user_roles: true, invites: true },
    });
    expect(merchant).toMatchObject({ status: "active", is_open: false, commission_bps: 2000 });
    expect(merchant.user_roles.map((r) => r.role)).toEqual(["merchant_owner"]);
    expect(merchant.invites[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await prisma.audit_logs.count({ where: { actor_id: admin, action: "merchant.approve" } }),
    ).toBeGreaterThanOrEqual(2);
  });

  it("refuses to approve twice or outside every zone, and rejects only pending applications", async () => {
    const outside = await newApplication(`Far ${tag}`, CEBU);
    const terms = {
      reviewerId: admin,
      ownerId: admin,
      slug: "never",
      commissionBps: 2000,
      foundingCommissionUntil: null,
      invite: { email: "x@example.test", tokenHash: "h", expiresAt: new Date() },
    };
    expect(await applications.approve({ ...terms, applicationId: outside })).toBeNull();

    const pending = await newApplication(`Reject ${tag}`);
    expect(await applications.reject(pending, admin, "Not a fit")).toBe(true);
    expect(await applications.reject(pending, admin, "Again")).toBe(false);
    expect(await applications.approve({ ...terms, applicationId: pending })).toBeNull();
    expect((await applications.findById(pending))?.rejectionReason).toBe("Not a fit");
  });

  it("reads and saves store settings, open state and closures", async () => {
    const { merchantId, slug } = await approved(`Settings ${tag}`);
    const hours = {
      mon: [{ open: "10:00", close: "14:00" }],
      tue: [],
      wed: [],
      thu: [],
      fri: [],
      sat: [],
      sun: [],
    };

    await stores.updateSettings(merchantId, {
      hours,
      defaultPrepMinutes: 25,
      acceptsCod: false,
      serviceRadiusKm: 2.5,
    });
    await stores.setOpen(merchantId, true);
    const closure = await stores.addClosure(merchantId, {
      closedOn: "2099-12-25",
      reason: "Pasko",
    });
    const duplicate = await stores.addClosure(merchantId, { closedOn: "2099-12-25" });
    const settings = await stores.settings(merchantId);

    expect(settings).toMatchObject({
      hours,
      defaultPrepMinutes: 25,
      acceptsCod: false,
      serviceRadiusKm: 2.5,
      zoneMaxRadiusKm: 8,
      isOpen: true,
      closures: [{ closedOn: "2099-12-25", reason: "Pasko" }],
    });
    expect(duplicate).toBeNull();
    expect(await stores.removeClosure(merchantId, closure?.id ?? "")).toBe(true);
    expect(await stores.removeClosure(merchantId, closure?.id ?? "")).toBe(false);
    expect((await stores.bySlug(slug))?.merchantId).toBe(merchantId);
    expect(await stores.settings(randomUUID())).toBeNull();
  });

  it("builds a menu with modifiers, reorders, toggles, replaces, imports and deletes", async () => {
    const { merchantId } = await approved(`Menu ${tag}`);
    const other = await approved(`Other ${tag}`);
    const silog = await menus.createCategory(merchantId, "Silog");
    const drinks = await menus.createCategory(merchantId, "Drinks");
    const item = {
      categoryId: silog.id,
      name: "Tapsilog",
      description: null,
      priceCentavos: 12050,
      photoPath: null,
      isAvailable: true,
      modifierGroups: [
        {
          name: "Rice",
          required: true,
          minSelect: 1,
          maxSelect: 1,
          options: [
            { name: "Plain", priceDeltaCentavos: 0 },
            { name: "Garlic", priceDeltaCentavos: 1500 },
          ],
        },
      ],
    };
    const { id } = await menus.createItem(merchantId, item);

    expect(await menus.hasCategory(merchantId, silog.id)).toBe(true);
    expect(await menus.hasCategory(other.merchantId, silog.id)).toBe(false);
    expect(await menus.reorderCategories(merchantId, [drinks.id, silog.id])).toBe(true);
    expect(await menus.reorderCategories(merchantId, [drinks.id])).toBe(false);
    expect(await menus.setItemAvailability(merchantId, id, false)).toBe(true);
    expect(await menus.setItemAvailability(other.merchantId, id, true)).toBe(false);
    expect(await menus.renameCategory(merchantId, drinks.id, "Inumin")).toBe(true);
    expect(await menus.renameCategory(other.merchantId, drinks.id, "Hacked")).toBe(false);

    let menu = await menus.menu(merchantId);
    expect(menu.map((c) => c.name)).toEqual(["Inumin", "Silog"]);
    expect(menu[1]?.items[0]).toMatchObject({
      name: "Tapsilog",
      priceCentavos: 12050,
      isAvailable: false,
    });
    expect(menu[1]?.items[0]?.modifierGroups[0]?.options.map((o) => o.priceDeltaCentavos)).toEqual([
      0, 1500,
    ]);

    expect(
      await menus.replaceItem(merchantId, id, {
        ...item,
        name: "Tapsilog Special",
        modifierGroups: [],
      }),
    ).toBe(true);
    expect(await menus.replaceItem(other.merchantId, id, item)).toBe(false);
    const imported = await menus.importItems(merchantId, [
      { category: "silog", name: "Longsilog", description: null, priceCentavos: 11000 },
      { category: "Desserts", name: "Halo-halo", description: "Ube", priceCentavos: 8500 },
    ]);
    expect(imported).toEqual({ created: 2, categoriesCreated: 1 });

    menu = await menus.menu(merchantId);
    expect(menu.map((c) => [c.name, c.items.map((i) => i.name)])).toEqual([
      ["Inumin", []],
      ["Silog", ["Tapsilog Special", "Longsilog"]],
      ["Desserts", ["Halo-halo"]],
    ]);
    expect(menu[1]?.items[0]?.modifierGroups).toEqual([]);

    expect(await menus.deleteItem(other.merchantId, id)).toBe(false);
    expect(await menus.deleteItem(merchantId, id)).toBe(true);
    expect(await menus.deleteCategory(other.merchantId, drinks.id)).toBe(false);
    expect(await menus.deleteCategory(merchantId, drinks.id)).toBe(true);
  });
});
