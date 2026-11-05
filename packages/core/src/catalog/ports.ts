import type { FeeRuleKind, MerchantCategory, PromoType, WeeklyHours } from "@klikgo/types";
import type { Centavos } from "../shared/money";
import type { GeoPoint } from "../merchant/ports";

/** The active zone that serves a pin. */
export interface ServiceZone {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

/** Which active zone serves a point (public.zone_for_point: smallest active zone first). */
export interface IServiceArea {
  zoneFor(point: GeoPoint): Promise<ServiceZone | null>;
}

/** One row of fee_rules. */
export interface FeeRule {
  readonly kind: FeeRuleKind;
  readonly minDistanceM: number | null;
  readonly maxDistanceM: number | null;
  readonly minSubtotalCentavos: number | null;
  readonly feeCentavos: Centavos;
  readonly priority: number;
}

/** A zone's delivery pricing inputs. */
export interface ZoneFees {
  readonly baseFeeCentavos: Centavos;
  readonly perKmCentavos: Centavos;
  readonly rules: readonly FeeRule[];
}

/** A live store as the feed and search need it. */
export interface StoreSummary {
  readonly merchantId: string;
  readonly slug: string;
  readonly name: string;
  readonly category: MerchantCategory;
  readonly description: string | null;
  readonly coverPhotoPath: string | null;
  readonly ratingAvg: number;
  readonly ratingCount: number;
  readonly location: GeoPoint;
  /** The store's own open toggle (and approval); hours are applied on top. */
  readonly isOpen: boolean;
  readonly hours: WeeklyHours;
  /** Upcoming holiday closures (YYYY-MM-DD, Manila). */
  readonly closedDates: readonly string[];
  readonly prepMinutes: number;
  /** Delivery radius in km (the zone maximum when the store has none). */
  readonly radiusKm: number;
  readonly minItemPriceCentavos: Centavos | null;
  readonly hasFreeDeliveryPromo: boolean;
}

/** A promo an admin chose to feature on the home screen. */
export interface FeaturedPromo {
  readonly code: string;
  readonly type: PromoType;
  readonly discountCentavos: Centavos | null;
  readonly discountBps: number | null;
  readonly minSubtotalCentavos: Centavos;
  readonly merchantId: string | null;
  readonly endsAt: Date;
}

/** Read model for discovery (all reads; RLS-safe data only). */
export interface ICatalogReadRepository {
  storesInZone(zoneId: string): Promise<StoreSummary[]>;
  zoneFees(zoneId: string): Promise<ZoneFees>;
  featuredPromos(zoneId: string, now: Date): Promise<FeaturedPromo[]>;
  /** Stores this customer ordered from before, most recent first. */
  recentMerchantIds(customerId: string, limit: number): Promise<string[]>;
}

/** An item with everything needed to price it. */
export interface PricedItem {
  readonly id: string;
  readonly name: string;
  readonly priceCentavos: Centavos;
  readonly isAvailable: boolean;
  readonly groups: readonly {
    readonly id: string;
    readonly name: string;
    readonly required: boolean;
    readonly minSelect: number;
    readonly maxSelect: number;
    readonly options: readonly {
      readonly id: string;
      readonly name: string;
      readonly priceDeltaCentavos: Centavos;
      readonly isAvailable: boolean;
    }[];
  }[];
}

/** What pricing a cart needs from the database. */
export interface QuoteCatalog {
  readonly merchant: {
    readonly id: string;
    readonly name: string;
    readonly zoneId: string;
    readonly location: GeoPoint;
    readonly isOpen: boolean;
    readonly hours: WeeklyHours;
    readonly closedDates: readonly string[];
    readonly prepMinutes: number;
    readonly radiusKm: number;
  };
  readonly fees: ZoneFees;
  readonly items: readonly PricedItem[];
}

/** Loads a live store's menu items and fees for pricing (null when the store is not live). */
export interface IPricingCatalog {
  loadForQuote(merchantId: string, itemIds: readonly string[]): Promise<QuoteCatalog | null>;
}

/** Raw search matches in a zone. */
export interface SearchMatches {
  readonly stores: readonly { readonly merchantId: string; readonly score: number }[];
  readonly dishes: readonly {
    readonly itemId: string;
    readonly merchantId: string;
    readonly name: string;
    readonly priceCentavos: Centavos;
    readonly isAvailable: boolean;
    readonly score: number;
  }[];
}

/** Full-text + trigram search over live stores and their menus in one zone. */
export interface ISearchRepository {
  search(zoneId: string, query: string): Promise<SearchMatches>;
}

/** A waitlist entry (phone already normalised). */
export interface WaitlistEntry {
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly barangay: string;
  readonly city: string | null;
  readonly location: GeoPoint;
}

export interface IWaitlistRepository {
  add(entry: WaitlistEntry): Promise<{ readonly id: string }>;
}

/** A customer's saved address. */
export interface SavedAddress {
  readonly id: string;
  readonly label: string;
  readonly location: GeoPoint;
  readonly street: string | null;
  readonly landmark: string | null;
  readonly barangay: string;
  readonly city: string;
  readonly notes: string | null;
  readonly contactPhone: string | null;
  readonly isDefault: boolean;
}

export type NewAddress = Omit<SavedAddress, "id">;

export interface IAddressRepository {
  listFor(userId: string): Promise<SavedAddress[]>;
  /** Saves the address; when it is the default, the previous default stops being one. */
  create(userId: string, address: NewAddress): Promise<{ readonly id: string }>;
}

/** Small time-bounded cache (per server instance) for hot, shareable reads. */
export interface ICache {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlSeconds: number): void;
}
