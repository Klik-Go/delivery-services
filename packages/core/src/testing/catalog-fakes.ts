import type {
  FeaturedPromo,
  IAddressRepository,
  ICache,
  ICatalogReadRepository,
  IPricingCatalog,
  ISearchRepository,
  IServiceArea,
  IWaitlistRepository,
  NewAddress,
  PricedItem,
  QuoteCatalog,
  SavedAddress,
  SearchMatches,
  ServiceZone,
  StoreSummary,
  WaitlistEntry,
  ZoneFees,
} from "../catalog/ports";
import type { GeoPoint } from "../merchant/ports";
import type { IPlaceSearch, PlaceLocation, PlaceSuggestion } from "../catalog/place-search";
import { NotFoundError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

/** Zones as boxes; the first matching active one serves the point. */
export class InMemoryServiceArea implements IServiceArea {
  readonly zones: (ServiceZone & { south: number; west: number; north: number; east: number })[] =
    [];

  zoneFor(point: GeoPoint): Promise<ServiceZone | null> {
    const z = this.zones.find(
      (zone) =>
        point.lat >= zone.south &&
        point.lat <= zone.north &&
        point.lng >= zone.west &&
        point.lng <= zone.east,
    );
    return Promise.resolve(z ? { id: z.id, name: z.name, slug: z.slug } : null);
  }
}

/** Stores, menus, fees and promos in memory (feed and pricing reads). */
export class InMemoryCatalog implements ICatalogReadRepository, IPricingCatalog {
  readonly stores: (StoreSummary & { zoneId: string; items: PricedItem[] })[] = [];
  readonly fees = new Map<string, ZoneFees>();
  readonly promos = new Map<string, FeaturedPromo[]>();
  readonly recent = new Map<string, string[]>();
  calls = 0;

  storesInZone(zoneId: string): Promise<StoreSummary[]> {
    this.calls += 1;
    return Promise.resolve(this.stores.filter((s) => s.zoneId === zoneId));
  }

  zoneFees(zoneId: string): Promise<ZoneFees> {
    return Promise.resolve(
      this.fees.get(zoneId) ?? { baseFeeCentavos: 3900, perKmCentavos: 1000, rules: [] },
    );
  }

  featuredPromos(zoneId: string): Promise<FeaturedPromo[]> {
    return Promise.resolve(this.promos.get(zoneId) ?? []);
  }

  recentMerchantIds(customerId: string, limit: number): Promise<string[]> {
    return Promise.resolve((this.recent.get(customerId) ?? []).slice(0, limit));
  }

  async loadForQuote(merchantId: string, itemIds: readonly string[]): Promise<QuoteCatalog | null> {
    const store = this.stores.find((s) => s.merchantId === merchantId);
    if (!store) return null;
    return {
      merchant: {
        id: store.merchantId,
        name: store.name,
        zoneId: store.zoneId,
        location: store.location,
        isOpen: store.isOpen,
        hours: store.hours,
        closedDates: store.closedDates,
        prepMinutes: store.prepMinutes,
        radiusKm: store.radiusKm,
      },
      fees: await this.zoneFees(store.zoneId),
      items: store.items.filter((item) => itemIds.includes(item.id)),
    };
  }
}

/** Case-insensitive substring search over the in-memory catalog. */
export class InMemorySearchRepository implements ISearchRepository {
  constructor(private readonly catalog: InMemoryCatalog) {}

  search(zoneId: string, query: string): Promise<SearchMatches> {
    const q = query.toLowerCase();
    const stores = this.catalog.stores.filter((s) => s.zoneId === zoneId);
    return Promise.resolve({
      stores: stores
        .filter((s) => s.name.toLowerCase().includes(q))
        .map((s) => ({ merchantId: s.merchantId, score: 1 })),
      dishes: stores.flatMap((s) =>
        s.items
          .filter((item) => item.name.toLowerCase().includes(q))
          .map((item) => ({
            itemId: item.id,
            merchantId: s.merchantId,
            name: item.name,
            priceCentavos: item.priceCentavos,
            isAvailable: item.isAvailable,
            score: 0.5,
          })),
      ),
    });
  }
}

export class InMemoryWaitlistRepository implements IWaitlistRepository {
  readonly entries: WaitlistEntry[] = [];

  add(entry: WaitlistEntry): Promise<{ id: string }> {
    this.entries.push(entry);
    return Promise.resolve({ id: `waitlist-${String(this.entries.length)}` });
  }
}

export class InMemoryAddressRepository implements IAddressRepository {
  readonly rows: (SavedAddress & { userId: string })[] = [];

  listFor(userId: string): Promise<SavedAddress[]> {
    return Promise.resolve(this.rows.filter((row) => row.userId === userId));
  }

  create(userId: string, address: NewAddress): Promise<{ id: string }> {
    if (address.isDefault)
      for (const row of this.rows)
        if (row.userId === userId) Object.assign(row, { isDefault: false });
    const id = `address-${String(this.rows.length + 1)}`;
    this.rows.push({ ...address, id, userId });
    return Promise.resolve({ id });
  }
}

/** A cache that honours TTLs against an injectable clock (`now` in ms). */
export class MemoryCache implements ICache {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= this.now()) return undefined;
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds: number): void {
    this.entries.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
  }
}

/** Place search that answers from a fixed list and counts calls. */
export class FakePlaceSearch implements IPlaceSearch {
  calls = 0;
  readonly places = new Map<string, PlaceLocation & { secondary: string }>([
    [
      "place-ayala",
      {
        label: "Ayala Avenue",
        secondary: "Makati City",
        location: { lat: 14.5547, lng: 121.0244 },
      },
    ],
  ]);

  suggest(query: string): Promise<Result<PlaceSuggestion[], AppError>> {
    this.calls += 1;
    const q = query.toLowerCase();
    return Promise.resolve(
      ok(
        [...this.places.entries()]
          .filter(([, p]) => p.label.toLowerCase().includes(q))
          .map(([id, p]) => ({ id, primary: p.label, secondary: p.secondary })),
      ),
    );
  }

  place(id: string): Promise<Result<PlaceLocation, AppError>> {
    this.calls += 1;
    const found = this.places.get(id);
    return Promise.resolve(
      found
        ? ok({ label: found.label, location: found.location })
        : err(new NotFoundError("Place", id)),
    );
  }
}
