import type {
  AppRole,
  FeeRuleKind,
  KycDocumentType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  VehicleType,
} from "@klikgo/types";
import type { GeoPoint } from "../merchant/ports";
import type { AppError } from "../shared/errors";
import type { Centavos } from "../shared/money";
import type { Result } from "../shared/result";

/** Which zones a console user runs: every zone (admins) or the ones they coordinate. */
export type ZoneScope = "all" | readonly string[];

/** One audit_logs row (append-only). */
export interface AuditEntry {
  readonly actorId: string;
  readonly actorRole: AppRole;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly meta: Readonly<Record<string, string | number | boolean | null>>;
}

export interface IAuditLog {
  record(entry: AuditEntry): Promise<void>;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/** A live order as the console shows it. */
export interface OpsOrder {
  readonly id: string;
  readonly code: string;
  readonly status: OrderStatus;
  readonly zoneId: string;
  readonly merchantId: string;
  readonly merchantName: string;
  readonly paymentMethod: PaymentMethod;
  readonly totalCentavos: Centavos;
  readonly riderId: string | null;
  readonly riderName: string | null;
  readonly prepMinutes: number | null;
  readonly placedAt: Date | null;
  readonly acceptedAt: Date | null;
  readonly readyAt: Date | null;
  readonly pickedUpAt: Date | null;
  /** The store missed its confirmation (Phase 6) or no rider took the job (Phase 7). */
  readonly flaggedAt: Date | null;
  readonly dispatchFlaggedAt: Date | null;
  readonly store: GeoPoint;
  readonly dropoff: GeoPoint;
}

export interface OrderHistoryEntry {
  readonly at: Date;
  readonly from: OrderStatus | null;
  readonly to: OrderStatus;
  readonly actorRole: AppRole | null;
}

export interface SupportNote {
  readonly id: string;
  readonly body: string;
  readonly authorRole: AppRole;
  readonly authorName: string | null;
  readonly at: Date;
}

export interface OpsOrderDetail extends OpsOrder {
  readonly customerId: string;
  readonly paymentStatus: PaymentStatus;
  readonly cancelReason: string | null;
  readonly rejectReason: string | null;
  readonly history: readonly OrderHistoryEntry[];
  readonly notes: readonly SupportNote[];
}

/** A rider as the console needs them for (re)assignment and the live map. */
export interface OpsRider {
  readonly id: string;
  readonly userId: string;
  readonly name: string | null;
  readonly zoneId: string;
  readonly status: "pending_kyc" | "active" | "suspended";
  readonly isOnline: boolean;
  readonly activeOrderId: string | null;
  readonly location: GeoPoint | null;
  readonly locationAt: Date | null;
}

export interface IOpsOrderRepository {
  /** Live orders (placed → picked up) in these zones, oldest first. */
  board(scope: ZoneScope): Promise<OpsOrder[]>;
  order(orderId: string): Promise<OpsOrderDetail | null>;
  rider(riderId: string): Promise<OpsRider | null>;
  riders(scope: ZoneScope): Promise<OpsRider[]>;
  /**
   * Gives the order to this rider, only while it is still with `expectedRiderId` (null: nobody)
   * and in one of `statuses`: open offers are withdrawn, the pay is fixed on the order.
   */
  assignRider(input: {
    readonly orderId: string;
    readonly riderId: string;
    readonly expectedRiderId: string | null;
    readonly earningsCentavos: Centavos;
  }): Promise<boolean>;
  addNote(input: {
    readonly orderId: string;
    readonly authorId: string;
    readonly authorRole: AppRole;
    readonly body: string;
  }): Promise<string>;
}

// ---------------------------------------------------------------------------
// Zones and fees
// ---------------------------------------------------------------------------

export interface FeeRuleView {
  readonly id: string;
  readonly zoneId: string;
  readonly name: string;
  readonly kind: FeeRuleKind;
  readonly minDistanceM: number | null;
  readonly maxDistanceM: number | null;
  readonly minSubtotalCentavos: Centavos | null;
  readonly feeCentavos: Centavos;
  readonly priority: number;
  readonly isActive: boolean;
}

/** Service radius per zone type (docs/BUSINESS.md §5.5), the same bands the database enforces. */
export const ZONE_RADIUS_KM: Readonly<
  Record<"barangay" | "city" | "provincial", readonly [number, number]>
> = {
  barangay: [3, 5],
  city: [8, 15],
  provincial: [20, 40],
};

export interface ZoneView {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly zoneType: "barangay" | "city" | "provincial";
  readonly baseFeeCentavos: Centavos;
  readonly perKmCentavos: Centavos;
  readonly maxRadiusKm: number;
  readonly isActive: boolean;
  readonly coordinatorId: string | null;
  readonly coordinatorName: string | null;
  /** The outline as [lng, lat] corners (first corner not repeated). */
  readonly ring: readonly (readonly [number, number])[];
  readonly feeRules: readonly FeeRuleView[];
}

export interface ZonePatch {
  readonly name?: string | undefined;
  readonly baseFeeCentavos?: Centavos | undefined;
  readonly perKmCentavos?: Centavos | undefined;
  readonly maxRadiusKm?: number | undefined;
  readonly isActive?: boolean | undefined;
}

export type FeeRuleFields = Omit<FeeRuleView, "id" | "zoneId">;
/** A partial change to a fee rule (absent or undefined fields stay as they are). */
export type FeeRulePatch = { readonly [K in keyof FeeRuleFields]?: FeeRuleFields[K] | undefined };

export interface IZoneAdminRepository {
  zones(scope: ZoneScope): Promise<ZoneView[]>;
  zone(zoneId: string): Promise<ZoneView | null>;
  update(zoneId: string, patch: ZonePatch): Promise<boolean>;
  /** Saves the outline; "invalid" when PostGIS finds it is not a simple polygon. */
  setArea(
    zoneId: string,
    ring: readonly (readonly [number, number])[],
  ): Promise<"ok" | "invalid" | "missing">;
  /** True when the user holds the coordinator role for this zone. */
  isZoneCoordinator(userId: string, zoneId: string): Promise<boolean>;
  setCoordinator(zoneId: string, userId: string | null): Promise<boolean>;
  feeRule(ruleId: string): Promise<FeeRuleView | null>;
  createFeeRule(zoneId: string, fields: FeeRuleFields): Promise<string>;
  updateFeeRule(ruleId: string, patch: FeeRulePatch): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export interface OpsMerchant {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly zoneId: string;
  readonly status: "pending" | "active" | "suspended";
  readonly statusReason: string | null;
  readonly commissionBps: number;
  readonly nextCommissionBps: number | null;
  readonly nextCommissionFrom: Date | null;
  readonly foundingCommissionUntil: Date | null;
}

export interface IMerchantAdminRepository {
  merchants(scope: ZoneScope): Promise<OpsMerchant[]>;
  merchant(merchantId: string): Promise<OpsMerchant | null>;
  setStatus(
    merchantId: string,
    status: "active" | "suspended",
    reason: string | null,
  ): Promise<boolean>;
  /** Changes the rate now (`from` ≤ now) or schedules it. */
  setCommission(merchantId: string, bps: number, from: Date, now: Date): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Riders and KYC
// ---------------------------------------------------------------------------

/** Appendix B documents a rider uploads; each must be accepted before approval. */
export const REQUIRED_KYC_DOCUMENTS: readonly KycDocumentType[] = [
  "government_id",
  "drivers_license",
  "vehicle_registration",
  "selfie_with_id",
  "payout_account",
];

export interface KycDocument {
  readonly id: string;
  readonly riderId: string;
  readonly type: KycDocumentType;
  readonly storagePath: string;
  readonly status: "pending" | "approved" | "rejected";
  readonly rejectionReason: string | null;
  readonly uploadedAt: Date;
}

export interface RiderApplication {
  readonly id: string;
  readonly userId: string;
  readonly name: string | null;
  readonly phone: string | null;
  readonly zoneId: string;
  readonly vehicleType: VehicleType;
  readonly plateNo: string | null;
  readonly payoutAccountName: string | null;
  readonly status: "pending_kyc" | "active" | "suspended";
  readonly statusReason: string | null;
  readonly ratingAvg: number;
  readonly ratingCount: number;
  readonly appliedAt: Date;
  /** The latest document of each type. */
  readonly documents: readonly KycDocument[];
}

export interface IRiderAdminRepository {
  riders(
    scope: ZoneScope,
    filter: "pending" | "active" | "suspended" | "coaching",
  ): Promise<RiderApplication[]>;
  rider(riderId: string): Promise<RiderApplication | null>;
  document(documentId: string): Promise<(KycDocument & { readonly zoneId: string }) | null>;
  reviewDocument(input: {
    readonly documentId: string;
    readonly status: "approved" | "rejected";
    readonly reason: string | null;
    readonly reviewerId: string;
  }): Promise<boolean>;
  /** Moves the rider to this status (offline when not active); false when already there. */
  setStatus(
    riderId: string,
    status: "active" | "suspended",
    reason: string | null,
  ): Promise<boolean>;
}

/** Private KYC files: short-lived links for reviewers, server-side uploads for riders. */
export interface IKycStorage {
  signedUrl(path: string, seconds: number): Promise<Result<string, AppError>>;
  upload(
    path: string,
    file: { readonly bytes: Uint8Array; readonly contentType: string },
  ): Promise<Result<void, AppError>>;
}

/** Applying to ride and uploading documents (the rider's side). */
export interface IRiderOnboardingRepository {
  /** Creates the rider (pending KYC) and grants the rider role; null when they already ride. */
  apply(input: {
    readonly userId: string;
    readonly zoneId: string;
    readonly vehicleType: VehicleType;
    readonly plateNo: string | null;
    readonly fullName: string;
    readonly payoutAccountName: string;
  }): Promise<string | null>;
  riderForUser(userId: string): Promise<RiderApplication | null>;
  addDocument(input: {
    readonly riderId: string;
    readonly type: KycDocumentType;
    readonly storagePath: string;
  }): Promise<string>;
  zoneExists(zoneId: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Settings and staff
// ---------------------------------------------------------------------------

export interface FeatureFlagView {
  readonly key: string;
  readonly description: string | null;
  readonly enabled: boolean;
  readonly rollout: Readonly<Record<string, unknown>>;
  readonly updatedAt: Date;
}

export interface ISettingsRepository {
  flags(): Promise<FeatureFlagView[]>;
  flag(key: string): Promise<FeatureFlagView | null>;
  updateFlag(
    key: string,
    value: { readonly enabled: boolean; readonly rollout: Readonly<Record<string, unknown>> },
    updatedBy: string,
  ): Promise<boolean>;
}

export interface StaffGrant {
  readonly id: string;
  readonly userId: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly role: AppRole;
  readonly merchantId: string | null;
  readonly merchantName: string | null;
  readonly zoneId: string | null;
  readonly zoneName: string | null;
  readonly createdAt: Date;
}

export interface IStaffRepository {
  staff(): Promise<StaffGrant[]>;
  grant(grantId: string): Promise<StaffGrant | null>;
  /** Removes the grant (and the zone's coordinator link when it was theirs). */
  revoke(grantId: string): Promise<boolean>;
}
