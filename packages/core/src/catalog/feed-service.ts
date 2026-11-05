import type { MerchantCategory } from "@klikgo/types";
import type { Clock } from "../ports/clock";
import type { GeoPoint, IPhotoStorage } from "../merchant/ports";
import type { PricingService } from "./pricing-service";
import type {
  FeaturedPromo,
  ICache,
  ICatalogReadRepository,
  IServiceArea,
  ServiceZone,
  StoreSummary,
  ZoneFees,
} from "./ports";
import { byOpenThenDistance, storeCard, type StoreCard } from "./store-card";

/** Home rails, in display order (docs/BUILD_PLAN.md Phase 4). */
export const RAILS = ["orderAgain", "near", "under100", "fast", "freeDelivery"] as const;
export type RailKey = (typeof RAILS)[number];

/** Feed data is shared by everyone in a zone for this long. */
export const FEED_CACHE_SECONDS = 60;

/** Everything the home screen needs in one round trip. */
export interface Feed {
  readonly zone: ServiceZone | null;
  readonly categories: readonly MerchantCategory[];
  readonly promos: readonly FeaturedPromo[];
  readonly rails: readonly { readonly key: RailKey; readonly stores: readonly StoreCard[] }[];
  readonly stores: readonly StoreCard[];
}

const UNDER_100 = 10_000;
const FAST_MINUTES = 30;
const RAIL_SIZE = 10;

/**
 * The customer home feed for a pin: zone, featured promos and rails of store cards (Near you,
 * Under ₱100, Fast, Free delivery, Order again). Zone-wide data is cached for 60 seconds; distances,
 * fees and arrival times are per customer.
 */
export class FeedService {
  constructor(
    private readonly deps: {
      serviceArea: IServiceArea;
      catalog: ICatalogReadRepository;
      pricing: PricingService;
      photos: IPhotoStorage;
      cache: ICache;
      clock: Clock;
    },
  ) {}

  async feed(point: GeoPoint, customerId: string | null): Promise<Feed> {
    const zone = await this.deps.serviceArea.zoneFor(point);
    if (!zone) return { zone: null, categories: [], promos: [], rails: [], stores: [] };
    const [stores, fees, promos] = await Promise.all([
      this.storesInZone(zone.id),
      this.zoneFees(zone.id),
      this.cached(`promos:${zone.id}`, () =>
        this.deps.catalog.featuredPromos(zone.id, this.deps.clock.now()),
      ),
    ]);
    const cards = this.cards(stores, fees, point).sort(byOpenThenDistance);
    const recent = customerId ? await this.deps.catalog.recentMerchantIds(customerId, 10) : [];
    const byId = new Map(cards.map((card) => [card.merchantId, card]));

    const rails: Record<RailKey, StoreCard[]> = {
      orderAgain: recent.map((id) => byId.get(id)).filter((c): c is StoreCard => c !== undefined),
      near: cards,
      under100: cards.filter(
        (c) => c.minItemPriceCentavos !== null && c.minItemPriceCentavos < UNDER_100,
      ),
      fast: cards.filter((c) => c.eta.max <= FAST_MINUTES),
      freeDelivery: cards.filter((c) => c.freeDelivery),
    };
    return {
      zone,
      categories: [...new Set(cards.map((card) => card.category))],
      promos,
      rails: RAILS.map((key) => ({ key, stores: rails[key].slice(0, RAIL_SIZE) })).filter(
        (rail) => rail.stores.length > 0,
      ),
      stores: cards,
    };
  }

  /** Store cards for a pin (shared with search). */
  cards(stores: readonly StoreSummary[], fees: ZoneFees, point: GeoPoint): StoreCard[] {
    const now = this.deps.clock.now();
    return stores
      .map((store) =>
        storeCard(
          store,
          point,
          (distanceM) => this.deps.pricing.deliveryFee(fees, distanceM),
          this.deps.photos,
          now,
        ),
      )
      .filter((card): card is StoreCard => card !== null);
  }

  storesInZone(zoneId: string): Promise<StoreSummary[]> {
    return this.cached(`stores:${zoneId}`, () => this.deps.catalog.storesInZone(zoneId));
  }

  zoneFees(zoneId: string): Promise<ZoneFees> {
    return this.cached(`fees:${zoneId}`, () => this.deps.catalog.zoneFees(zoneId));
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.deps.cache.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await load();
    this.deps.cache.set(key, value, FEED_CACHE_SECONDS);
    return value;
  }
}
