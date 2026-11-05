import type {
  MerchantApplicationStatus,
  MerchantCategory,
  StoreClosureInput,
  WeeklyHours,
} from "@klikgo/types";
import type { AppError } from "../shared/errors";
import type { Centavos } from "../shared/money";
import type { Result } from "../shared/result";

/** A map pin (WGS84). */
export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

/** Finds the delivery zone that covers a point. */
export interface IZoneLocator {
  zoneAt(point: GeoPoint): Promise<{ readonly id: string; readonly name: string } | null>;
}

/** A partner application as submitted (phone already normalised to +639…). */
export interface NewMerchantApplication {
  readonly businessName: string;
  readonly ownerName: string;
  readonly phone: string;
  readonly email: string;
  readonly category: MerchantCategory;
  readonly barangay: string;
  readonly city: string;
  readonly addressLine: string | null;
  readonly location: GeoPoint;
  readonly zoneId: string | null;
}

/** A stored partner application, as reviewers see it. */
export interface MerchantApplication extends NewMerchantApplication {
  readonly id: string;
  readonly status: MerchantApplicationStatus;
  readonly zoneName: string | null;
  readonly merchantId: string | null;
  readonly rejectionReason: string | null;
  readonly createdAt: Date;
}

/** Everything the approval transaction writes. */
export interface ApplicationApproval {
  readonly applicationId: string;
  readonly reviewerId: string;
  readonly ownerId: string;
  /** Preferred slug; the repository appends -2, -3… if it is taken. */
  readonly slug: string;
  readonly commissionBps: number;
  readonly foundingCommissionUntil: Date | null;
  readonly invite: { readonly email: string; readonly tokenHash: string; readonly expiresAt: Date };
}

/** merchant_applications (+ the approval transaction that creates the merchant). */
export interface IMerchantApplicationRepository {
  create(application: NewMerchantApplication): Promise<{ readonly id: string }>;
  /** Applications with this status; `zoneIds` null means every zone (admins). */
  list(filter: {
    readonly status: MerchantApplicationStatus;
    readonly zoneIds: readonly string[] | null;
  }): Promise<MerchantApplication[]>;
  findById(id: string): Promise<MerchantApplication | null>;
  /**
   * In one transaction: creates the merchant (active, closed), grants merchant_owner, records the
   * invite, marks the application approved and writes an audit row. Null if no longer pending.
   */
  approve(approval: ApplicationApproval): Promise<{ merchantId: string; slug: string } | null>;
  /** Marks a pending application rejected (with an audit row); false if it was not pending. */
  reject(id: string, reviewerId: string, reason: string): Promise<boolean>;
}

/** A holiday closure. */
export interface StoreClosure {
  readonly id: string;
  /** Calendar date in Asia/Manila (YYYY-MM-DD). */
  readonly closedOn: string;
  readonly reason: string | null;
}

/** What the store settings page shows. */
export interface StoreSettings {
  readonly merchantId: string;
  readonly name: string;
  readonly slug: string;
  readonly status: "pending" | "active" | "suspended";
  readonly isOpen: boolean;
  readonly hours: WeeklyHours;
  readonly defaultPrepMinutes: number;
  readonly acceptsCod: boolean;
  readonly serviceRadiusKm: number | null;
  readonly zoneMaxRadiusKm: number;
  readonly closures: readonly StoreClosure[];
}

/** Settings fields the owner may change. */
export interface StoreSettingsUpdate {
  readonly hours: WeeklyHours;
  readonly defaultPrepMinutes: number;
  readonly acceptsCod: boolean;
  readonly serviceRadiusKm: number | null;
}

/** Store settings, open/closed and holiday closures (merchants, merchant_closures). */
export interface IStoreRepository {
  settings(merchantId: string): Promise<StoreSettings | null>;
  updateSettings(merchantId: string, update: StoreSettingsUpdate): Promise<void>;
  setOpen(merchantId: string, isOpen: boolean): Promise<void>;
  /** Null when the store already has a closure on that date. */
  addClosure(
    merchantId: string,
    closure: StoreClosureInput,
  ): Promise<{ readonly id: string } | null>;
  removeClosure(merchantId: string, closureId: string): Promise<boolean>;
}

export interface MenuOption {
  readonly id: string;
  readonly name: string;
  readonly priceDeltaCentavos: Centavos;
  readonly isAvailable: boolean;
}

export interface MenuModifierGroup {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
  readonly minSelect: number;
  readonly maxSelect: number;
  readonly options: readonly MenuOption[];
}

export interface MenuItem {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceCentavos: Centavos;
  readonly isAvailable: boolean;
  readonly photoPath: string | null;
  readonly modifierGroups: readonly MenuModifierGroup[];
}

export interface MenuCategory {
  readonly id: string;
  readonly name: string;
  readonly sort: number;
  readonly items: readonly MenuItem[];
}

/** A menu item to create or replace (prices already in centavos). */
export interface MenuItemDraft {
  readonly categoryId: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceCentavos: Centavos;
  readonly photoPath: string | null;
  readonly isAvailable: boolean;
  readonly modifierGroups: readonly {
    readonly name: string;
    readonly required: boolean;
    readonly minSelect: number;
    readonly maxSelect: number;
    readonly options: readonly { readonly name: string; readonly priceDeltaCentavos: Centavos }[];
  }[];
}

/** One reviewed import row (category by name). */
export interface ImportedMenuItem {
  readonly category: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceCentavos: Centavos;
}

/** Menus: categories → items → modifier groups → options, always scoped to one merchant. */
export interface IMenuRepository {
  menu(merchantId: string): Promise<MenuCategory[]>;
  createCategory(merchantId: string, name: string): Promise<{ readonly id: string }>;
  renameCategory(merchantId: string, categoryId: string, name: string): Promise<boolean>;
  /** Sets sort = position; false unless `categoryIds` is exactly the store's categories. */
  reorderCategories(merchantId: string, categoryIds: readonly string[]): Promise<boolean>;
  deleteCategory(merchantId: string, categoryId: string): Promise<boolean>;
  hasCategory(merchantId: string, categoryId: string): Promise<boolean>;
  createItem(merchantId: string, item: MenuItemDraft): Promise<{ readonly id: string }>;
  /** Replaces the item and its modifier groups; false if the item is not this store's. */
  replaceItem(merchantId: string, itemId: string, item: MenuItemDraft): Promise<boolean>;
  setItemAvailability(merchantId: string, itemId: string, isAvailable: boolean): Promise<boolean>;
  deleteItem(merchantId: string, itemId: string): Promise<boolean>;
  /** Adds the items, creating categories by name when missing, in one transaction. */
  importItems(
    merchantId: string,
    items: readonly ImportedMenuItem[],
  ): Promise<{ readonly created: number; readonly categoriesCreated: number }>;
}

/** A one-time upload link for a menu photo. */
export interface PhotoUpload {
  readonly path: string;
  readonly uploadUrl: string;
  readonly token: string;
}

/** Menu photo storage (Supabase Storage bucket menu-photos). */
export interface IPhotoStorage {
  createUpload(path: string): Promise<Result<PhotoUpload, AppError>>;
  publicUrl(path: string): string;
}

/** An image to read a menu from. */
export interface MenuImage {
  readonly data: Uint8Array;
  readonly mimeType: string;
}

/** One item a parser read from a menu photo. */
export interface ParsedMenuItem {
  readonly category: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceCentavos: Centavos;
  /** 0–1: how sure the parser is (shown so the merchant checks low-confidence rows first). */
  readonly confidence: number;
}

/** Reads a printed menu photo into draft items (Gemini in production, a fake in tests). */
export interface IMenuParser {
  parse(image: MenuImage): Promise<Result<ParsedMenuItem[], AppError>>;
}

/** A live store as customers see it. */
export interface Storefront {
  readonly merchantId: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly category: MerchantCategory;
  readonly isOpen: boolean;
  readonly acceptsCod: boolean;
  readonly defaultPrepMinutes: number;
  readonly addressLine: string | null;
}

/** Public, read-only lookups of live stores. */
export interface IStorefrontRepository {
  /** Only active stores; null otherwise. */
  bySlug(slug: string): Promise<Storefront | null>;
}
