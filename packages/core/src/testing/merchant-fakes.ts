import type { StoreClosureInput } from "@klikgo/types";
import type {
  ApplicationApproval,
  GeoPoint,
  IMenuParser,
  IMenuRepository,
  IMerchantApplicationRepository,
  IPhotoStorage,
  IStoreRepository,
  IStorefrontRepository,
  IZoneLocator,
  ImportedMenuItem,
  MenuCategory,
  MenuImage,
  MenuItem,
  MenuItemDraft,
  MerchantApplication,
  NewMerchantApplication,
  ParsedMenuItem,
  PhotoUpload,
  StoreSettings,
  StoreSettingsUpdate,
  Storefront,
} from "../merchant/ports";
import type { AppError } from "../shared/errors";
import { ok, type Result } from "../shared/result";

let sequence = 0;
/** Deterministic ids for in-memory fakes. */
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${String(sequence)}`;
}

/** Zones as axis-aligned boxes (enough for tests). */
export class InMemoryZoneLocator implements IZoneLocator {
  readonly zones: {
    id: string;
    name: string;
    south: number;
    west: number;
    north: number;
    east: number;
  }[] = [];

  zoneAt(point: GeoPoint): Promise<{ id: string; name: string } | null> {
    const zone = this.zones.find(
      (z) =>
        point.lat >= z.south && point.lat <= z.north && point.lng >= z.west && point.lng <= z.east,
    );
    return Promise.resolve(zone ? { id: zone.id, name: zone.name } : null);
  }
}

/** merchant_applications in memory, including the approval "transaction". */
export class InMemoryMerchantApplicationRepository implements IMerchantApplicationRepository {
  readonly applications = new Map<string, MerchantApplication>();
  readonly approvals: ApplicationApproval[] = [];
  readonly takenSlugs = new Set<string>();
  zoneNames = new Map<string, string>();

  create(application: NewMerchantApplication): Promise<{ id: string }> {
    const id = nextId("application");
    this.applications.set(id, {
      ...application,
      id,
      status: "pending",
      zoneName: application.zoneId ? (this.zoneNames.get(application.zoneId) ?? null) : null,
      merchantId: null,
      rejectionReason: null,
      createdAt: new Date(),
    });
    return Promise.resolve({ id });
  }

  list(filter: {
    status: MerchantApplication["status"];
    zoneIds: readonly string[] | null;
  }): Promise<MerchantApplication[]> {
    return Promise.resolve(
      [...this.applications.values()].filter(
        (a) =>
          a.status === filter.status &&
          (filter.zoneIds === null || (a.zoneId !== null && filter.zoneIds.includes(a.zoneId))),
      ),
    );
  }

  findById(id: string): Promise<MerchantApplication | null> {
    return Promise.resolve(this.applications.get(id) ?? null);
  }

  approve(approval: ApplicationApproval): Promise<{ merchantId: string; slug: string } | null> {
    const application = this.applications.get(approval.applicationId);
    if (!application || application.status !== "pending") return Promise.resolve(null);
    let slug = approval.slug;
    for (let n = 2; this.takenSlugs.has(slug); n += 1) slug = `${approval.slug}-${String(n)}`;
    this.takenSlugs.add(slug);
    const merchantId = nextId("merchant");
    this.applications.set(application.id, { ...application, status: "approved", merchantId });
    this.approvals.push(approval);
    return Promise.resolve({ merchantId, slug });
  }

  reject(id: string, _reviewerId: string, reason: string): Promise<boolean> {
    const application = this.applications.get(id);
    if (!application || application.status !== "pending") return Promise.resolve(false);
    this.applications.set(id, { ...application, status: "rejected", rejectionReason: reason });
    return Promise.resolve(true);
  }
}

/** Store settings and closures in memory. */
export class InMemoryStoreRepository implements IStoreRepository, IStorefrontRepository {
  readonly stores = new Map<string, StoreSettings & { description: string | null }>();

  /** Adds a store with sensible defaults (closed, active, 5 km zone). */
  add(merchantId: string, overrides: Partial<StoreSettings> = {}): void {
    this.stores.set(merchantId, {
      merchantId,
      name: "Aling Nena's Karinderya",
      slug: "aling-nenas-karinderya",
      status: "active",
      isOpen: false,
      hours: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
      defaultPrepMinutes: 15,
      acceptsCod: true,
      serviceRadiusKm: null,
      zoneMaxRadiusKm: 5,
      closures: [],
      description: null,
      ...overrides,
    });
  }

  settings(merchantId: string): Promise<StoreSettings | null> {
    return Promise.resolve(this.stores.get(merchantId) ?? null);
  }

  updateSettings(merchantId: string, update: StoreSettingsUpdate): Promise<void> {
    const store = this.stores.get(merchantId);
    if (store) this.stores.set(merchantId, { ...store, ...update });
    return Promise.resolve();
  }

  setOpen(merchantId: string, isOpen: boolean): Promise<void> {
    const store = this.stores.get(merchantId);
    if (store) this.stores.set(merchantId, { ...store, isOpen });
    return Promise.resolve();
  }

  addClosure(merchantId: string, closure: StoreClosureInput): Promise<{ id: string } | null> {
    const store = this.stores.get(merchantId);
    if (!store || store.closures.some((c) => c.closedOn === closure.closedOn))
      return Promise.resolve(null);
    const id = nextId("closure");
    this.stores.set(merchantId, {
      ...store,
      closures: [
        ...store.closures,
        { id, closedOn: closure.closedOn, reason: closure.reason ?? null },
      ],
    });
    return Promise.resolve({ id });
  }

  removeClosure(merchantId: string, closureId: string): Promise<boolean> {
    const store = this.stores.get(merchantId);
    if (!store?.closures.some((c) => c.id === closureId)) return Promise.resolve(false);
    this.stores.set(merchantId, {
      ...store,
      closures: store.closures.filter((c) => c.id !== closureId),
    });
    return Promise.resolve(true);
  }

  bySlug(slug: string): Promise<Storefront | null> {
    const store = [...this.stores.values()].find((s) => s.slug === slug && s.status === "active");
    return Promise.resolve(
      store
        ? {
            merchantId: store.merchantId,
            name: store.name,
            slug: store.slug,
            description: store.description,
            category: "food",
            isOpen: store.isOpen,
            acceptsCod: store.acceptsCod,
            defaultPrepMinutes: store.defaultPrepMinutes,
            addressLine: null,
          }
        : null,
    );
  }
}

/** Menus in memory, scoped by merchant exactly like the database. */
export class InMemoryMenuRepository implements IMenuRepository {
  readonly categories = new Map<string, { merchantId: string; name: string; sort: number }>();
  readonly items = new Map<string, MenuItemDraft & { merchantId: string; sort: number }>();

  menu(merchantId: string): Promise<MenuCategory[]> {
    const categories = [...this.categories.entries()]
      .filter(([, c]) => c.merchantId === merchantId)
      .sort(([, a], [, b]) => a.sort - b.sort)
      .map(([id, c]) => ({
        id,
        name: c.name,
        sort: c.sort,
        items: [...this.items.entries()]
          .filter(([, item]) => item.categoryId === id)
          .map(([itemId, item]) => toMenuItem(itemId, item)),
      }));
    return Promise.resolve(categories);
  }

  createCategory(merchantId: string, name: string): Promise<{ id: string }> {
    const id = nextId("category");
    const sort = [...this.categories.values()].filter((c) => c.merchantId === merchantId).length;
    this.categories.set(id, { merchantId, name, sort });
    return Promise.resolve({ id });
  }

  renameCategory(merchantId: string, categoryId: string, name: string): Promise<boolean> {
    const category = this.categories.get(categoryId);
    if (category?.merchantId !== merchantId) return Promise.resolve(false);
    this.categories.set(categoryId, { ...category, name });
    return Promise.resolve(true);
  }

  reorderCategories(merchantId: string, categoryIds: readonly string[]): Promise<boolean> {
    const mine = [...this.categories.entries()].filter(([, c]) => c.merchantId === merchantId);
    const same =
      mine.length === categoryIds.length && mine.every(([id]) => categoryIds.includes(id));
    if (!same) return Promise.resolve(false);
    categoryIds.forEach((id, sort) => {
      const category = this.categories.get(id);
      if (category) this.categories.set(id, { ...category, sort });
    });
    return Promise.resolve(true);
  }

  deleteCategory(merchantId: string, categoryId: string): Promise<boolean> {
    if (this.categories.get(categoryId)?.merchantId !== merchantId) return Promise.resolve(false);
    this.categories.delete(categoryId);
    for (const [id, item] of this.items) if (item.categoryId === categoryId) this.items.delete(id);
    return Promise.resolve(true);
  }

  hasCategory(merchantId: string, categoryId: string): Promise<boolean> {
    return Promise.resolve(this.categories.get(categoryId)?.merchantId === merchantId);
  }

  createItem(merchantId: string, item: MenuItemDraft): Promise<{ id: string }> {
    const id = nextId("item");
    this.items.set(id, { ...item, merchantId, sort: this.items.size });
    return Promise.resolve({ id });
  }

  replaceItem(merchantId: string, itemId: string, item: MenuItemDraft): Promise<boolean> {
    const existing = this.items.get(itemId);
    if (existing?.merchantId !== merchantId) return Promise.resolve(false);
    this.items.set(itemId, { ...item, merchantId, sort: existing.sort });
    return Promise.resolve(true);
  }

  setItemAvailability(merchantId: string, itemId: string, isAvailable: boolean): Promise<boolean> {
    const existing = this.items.get(itemId);
    if (existing?.merchantId !== merchantId) return Promise.resolve(false);
    this.items.set(itemId, { ...existing, isAvailable });
    return Promise.resolve(true);
  }

  deleteItem(merchantId: string, itemId: string): Promise<boolean> {
    if (this.items.get(itemId)?.merchantId !== merchantId) return Promise.resolve(false);
    this.items.delete(itemId);
    return Promise.resolve(true);
  }

  async importItems(
    merchantId: string,
    items: readonly ImportedMenuItem[],
  ): Promise<{ created: number; categoriesCreated: number }> {
    let categoriesCreated = 0;
    for (const item of items) {
      let categoryId = [...this.categories.entries()].find(
        ([, c]) =>
          c.merchantId === merchantId && c.name.toLowerCase() === item.category.toLowerCase(),
      )?.[0];
      if (!categoryId) {
        categoryId = (await this.createCategory(merchantId, item.category)).id;
        categoriesCreated += 1;
      }
      await this.createItem(merchantId, {
        categoryId,
        name: item.name,
        description: item.description,
        priceCentavos: item.priceCentavos,
        photoPath: null,
        isAvailable: true,
        modifierGroups: [],
      });
    }
    return { created: items.length, categoriesCreated };
  }
}

function toMenuItem(id: string, item: MenuItemDraft): MenuItem {
  return {
    id,
    categoryId: item.categoryId,
    name: item.name,
    description: item.description,
    priceCentavos: item.priceCentavos,
    isAvailable: item.isAvailable,
    photoPath: item.photoPath,
    modifierGroups: item.modifierGroups.map((group, g) => ({
      id: `${id}-group-${String(g)}`,
      name: group.name,
      required: group.required,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      options: group.options.map((option, o) => ({
        id: `${id}-option-${String(g)}-${String(o)}`,
        name: option.name,
        priceDeltaCentavos: option.priceDeltaCentavos,
        isAvailable: true,
      })),
    })),
  };
}

/** Photo storage that hands out fake signed links and remembers them. */
export class FakePhotoStorage implements IPhotoStorage {
  readonly uploads: string[] = [];

  createUpload(path: string): Promise<Result<PhotoUpload, AppError>> {
    this.uploads.push(path);
    return Promise.resolve(
      ok({ path, uploadUrl: `https://storage.example.test/upload/${path}`, token: "fake-token" }),
    );
  }

  publicUrl(path: string): string {
    return `https://storage.example.test/menu-photos/${path}`;
  }
}

/** The sample printed menu the fake parser "reads" (stable, so tests and demos agree). */
export const FAKE_MENU_ITEMS: readonly ParsedMenuItem[] = [
  {
    category: "Ulam",
    name: "Chicken Adobo",
    description: "With rice",
    priceCentavos: 12000,
    confidence: 0.96,
  },
  {
    category: "Ulam",
    name: "Pork Sinigang",
    description: null,
    priceCentavos: 15000,
    confidence: 0.91,
  },
  {
    category: "Noodles",
    name: "Pancit Canton",
    description: null,
    priceCentavos: 9000,
    confidence: 0.88,
  },
  {
    category: "Desserts",
    name: "Halo-halo",
    description: "Ube, leche flan",
    priceCentavos: 7500,
    confidence: 0.62,
  },
];

/** A menu parser that returns {@link FAKE_MENU_ITEMS} for any image and records the calls. */
export class FakeMenuParser implements IMenuParser {
  readonly images: MenuImage[] = [];
  result: Result<ParsedMenuItem[], AppError> = ok([...FAKE_MENU_ITEMS]);

  parse(image: MenuImage): Promise<Result<ParsedMenuItem[], AppError>> {
    this.images.push(image);
    return Promise.resolve(this.result);
  }
}
