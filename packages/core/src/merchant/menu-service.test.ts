import type { MenuItemInput } from "@klikgo/types";
import { beforeEach, describe, expect, it } from "vitest";
import { AuthorizationService } from "../auth/authorization-service";
import {
  FakePhotoStorage,
  InMemoryMenuRepository,
  InMemoryStoreRepository,
  MemoryLogger,
  sessionUser,
} from "../testing";
import { MenuService } from "./menu-service";
import { StorefrontService } from "./storefront-service";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const PHOTO = "33333333-3333-4333-8333-333333333333";
const staffA = sessionUser("staff-a", [{ role: "merchant_staff", merchantId: A }]);
const staffB = sessionUser("staff-b", [{ role: "merchant_staff", merchantId: B }]);

describe("MenuService", () => {
  let menus: InMemoryMenuRepository;
  let photos: FakePhotoStorage;
  let service: MenuService;
  let silog: string;

  const item = (overrides: Partial<MenuItemInput> = {}): MenuItemInput => ({
    categoryId: silog,
    name: "Tapsilog",
    price: "120.50",
    isAvailable: true,
    modifierGroups: [
      {
        name: "Rice",
        required: true,
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: "Plain rice", priceDelta: "0" },
          { name: "Garlic rice", priceDelta: "15" },
        ],
      },
    ],
    ...overrides,
  });

  beforeEach(async () => {
    menus = new InMemoryMenuRepository();
    photos = new FakePhotoStorage();
    service = new MenuService({
      menus,
      photos,
      authz: new AuthorizationService(),
      logger: new MemoryLogger(),
      newId: () => PHOTO,
    });
    const created = await service.createCategory(staffA, A, "Silog Meals");
    if (!created.ok) throw new Error("setup");
    silog = created.value.id;
  });

  it("stores prices typed in pesos as centavos, including modifier extras", async () => {
    await service.createItem(staffA, A, item());

    const menu = await service.menu(staffA, A);
    const tapsilog = menu.ok ? menu.value[0]?.items[0] : undefined;
    expect(tapsilog?.priceCentavos).toBe(12050);
    expect(tapsilog?.modifierGroups[0]?.options.map((o) => o.priceDeltaCentavos)).toEqual([
      0, 1500,
    ]);
  });

  it("refuses a free item or a category of another store", async () => {
    const free = await service.createItem(staffA, A, item({ price: "0" }));
    const foreign = await menus.createCategory(B, "Kape");
    const wrongCategory = await service.createItem(staffA, A, item({ categoryId: foreign.id }));
    expect(!free.ok && free.error.code).toBe("VALIDATION_FAILED");
    expect(!wrongCategory.ok && wrongCategory.error.code).toBe("VALIDATION_FAILED");
  });

  it("only accepts photos from the store's own folder and shows their public URL", async () => {
    const theirs = await service.createItem(staffA, A, item({ photoPath: `${B}/${PHOTO}.webp` }));
    const mine = await service.createItem(staffA, A, item({ photoPath: `${A}/${PHOTO}.webp` }));
    expect(!theirs.ok && theirs.error.message).toBe("That photo belongs to another store.");
    expect(mine.ok).toBe(true);

    const menu = await service.menu(staffA, A);
    expect(menu.ok && menu.value[0]?.items[0]?.photoUrl).toBe(
      `https://storage.example.test/menu-photos/${A}/${PHOTO}.webp`,
    );
  });

  it("issues photo upload links inside the store's folder only", async () => {
    const upload = await service.createPhotoUpload(staffA, A);
    const other = await service.createPhotoUpload(staffA, B);
    expect(upload.ok && upload.value.path).toBe(`${A}/${PHOTO}.webp`);
    expect(!other.ok && other.error.code).toBe("FORBIDDEN");
  });

  it("never lets staff of one store read or change another store's menu", async () => {
    const created = await service.createItem(staffA, A, item());
    if (!created.ok) throw new Error("setup");

    const attempts = await Promise.all([
      service.menu(staffB, A),
      service.renameCategory(staffB, A, silog, "Hacked"),
      service.setAvailability(staffB, A, created.value.id, false),
      service.deleteItem(staffB, A, created.value.id),
      service.updateItem(staffB, A, created.value.id, item()),
      service.reorderCategories(staffB, A, [silog]),
      service.deleteCategory(staffB, A, silog),
      service.importReviewedItems(staffB, A, [{ category: "X", name: "Y", price: "1" }]),
    ]);
    expect(attempts.map((r) => !r.ok && r.error.code)).toEqual(Array(8).fill("FORBIDDEN"));
    // Using its own store id with another store's item finds nothing either.
    const viaOwnStore = await service.setAvailability(staffB, B, created.value.id, false);
    expect(!viaOwnStore.ok && viaOwnStore.error.code).toBe("NOT_FOUND");
  });

  it("marks items sold out, edits and deletes them", async () => {
    const created = await service.createItem(staffA, A, item());
    if (!created.ok) throw new Error("setup");

    await service.setAvailability(staffA, A, created.value.id, false);
    await service.updateItem(staffA, A, created.value.id, item({ name: "Tapsilog Special" }));
    let menu = await service.menu(staffA, A);
    expect(menu.ok && menu.value[0]?.items[0]).toMatchObject({
      name: "Tapsilog Special",
      isAvailable: true,
    });

    expect((await service.deleteItem(staffA, A, created.value.id)).ok).toBe(true);
    menu = await service.menu(staffA, A);
    expect(menu.ok && menu.value[0]?.items).toEqual([]);
    expect((await service.deleteItem(staffA, A, created.value.id)).ok).toBe(false);
    expect((await service.updateItem(staffA, A, created.value.id, item())).ok).toBe(false);
  });

  it("reorders, renames and deletes categories", async () => {
    const drinks = await service.createCategory(staffA, A, "Drinks");
    if (!drinks.ok) throw new Error("setup");

    expect((await service.reorderCategories(staffA, A, [drinks.value.id, silog])).ok).toBe(true);
    expect((await service.renameCategory(staffA, A, drinks.value.id, "Inumin")).ok).toBe(true);
    const menu = await service.menu(staffA, A);
    expect(menu.ok && menu.value.map((c) => c.name)).toEqual(["Inumin", "Silog Meals"]);

    const partial = await service.reorderCategories(staffA, A, [silog]);
    const repeated = await service.reorderCategories(staffA, A, [silog, silog]);
    expect(!partial.ok && partial.error.code).toBe("VALIDATION_FAILED");
    expect(!repeated.ok && repeated.error.code).toBe("VALIDATION_FAILED");
    expect((await service.deleteCategory(staffA, A, drinks.value.id)).ok).toBe(true);
    expect((await service.deleteCategory(staffA, A, drinks.value.id)).ok).toBe(false);
    expect((await service.renameCategory(staffA, A, drinks.value.id, "X")).ok).toBe(false);
  });

  it("saves reviewed import drafts into existing or new categories", async () => {
    const saved = await service.importReviewedItems(staffA, A, [
      { category: "silog meals", name: "Longsilog", price: "110" },
      { category: "Desserts", name: "Halo-halo", price: "85", description: "Ube" },
    ]);
    expect(saved).toEqual({ ok: true, value: { created: 2, categoriesCreated: 1 } });
    const menu = await service.menu(staffA, A);
    expect(menu.ok && menu.value.map((c) => [c.name, c.items.map((i) => i.priceCentavos)])).toEqual(
      [
        ["Silog Meals", [11000]],
        ["Desserts", [8500]],
      ],
    );
  });

  it("shows live stores publicly with their non-empty categories only", async () => {
    await service.createItem(staffA, A, item());
    await service.createCategory(staffA, A, "Empty");
    const stores = new InMemoryStoreRepository();
    stores.add(A, { slug: "aling-nena" });
    stores.add(B, { slug: "pending-store", status: "pending" });
    const storefronts = new StorefrontService({ storefronts: stores, menus, menuService: service });

    const live = await storefronts.store("aling-nena");
    const pending = await storefronts.store("pending-store");

    expect(live.ok && live.value.menu.map((c) => c.name)).toEqual(["Silog Meals"]);
    expect(!pending.ok && pending.error.code).toBe("NOT_FOUND");
  });
});
