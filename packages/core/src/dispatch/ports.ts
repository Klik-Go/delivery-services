import type { OrderStatus, PaymentMethod, VehicleType } from "@klikgo/types";
import type { GeoPoint } from "../merchant/ports";
import type { LedgerTxn } from "../ordering/ports";
import type { Centavos } from "../shared/money";

/** Dispatch and delivery rules (feature flag `dispatch`; admin editor in Phase 8). */
export interface DispatchSettings {
  /** How long a rider has to answer an offer. */
  readonly offerSeconds: number;
  /** Offers per order before the coordinator is alerted. */
  readonly maxAttempts: number;
  /** Search radius around the store. */
  readonly maxDistanceM: number;
  /** Dispatch when the store accepts, or `leadMinutes` before the food should be ready. */
  readonly start: "accept" | "before_ready";
  readonly leadMinutes: number;
  /** Orders at or above this total need the customer's PIN at the door. */
  readonly pinThresholdCentavos: Centavos;
  /** Rider pay: base + per km beyond the free kilometres (road distance store → drop-off). */
  readonly riderBaseCentavos: Centavos;
  readonly riderPerKmCentavos: Centavos;
  readonly riderFreeKm: number;
  /** Average rider speed for arrival estimates. */
  readonly avgSpeedKph: number;
}

export const DEFAULT_DISPATCH_SETTINGS: DispatchSettings = {
  offerSeconds: 30,
  maxAttempts: 5,
  maxDistanceM: 5000,
  start: "accept",
  leadMinutes: 10,
  pinThresholdCentavos: 50000,
  riderBaseCentavos: 3500,
  riderPerKmCentavos: 1000,
  riderFreeKm: 2,
  avgSpeedKph: 20,
};

export interface IDispatchSettingsSource {
  load(): Promise<DispatchSettings>;
}

/** What dispatch needs to know about an order. */
export interface DispatchJob {
  readonly id: string;
  readonly code: string;
  readonly zoneId: string;
  readonly merchantName: string;
  readonly status: OrderStatus;
  readonly riderId: string | null;
  readonly paymentMethod: PaymentMethod;
  readonly totalCentavos: Centavos;
  readonly pickup: GeoPoint;
  readonly dropoff: GeoPoint;
  readonly attempts: number;
  readonly flaggedAt: Date | null;
  /** When the store expects the food (accepted + prep time); null before acceptance. */
  readonly readyBy: Date | null;
  readonly hasOpenOffer: boolean;
}

/** An online, free rider near the store (nearest first), with the cash they already carry. */
export interface RiderCandidate {
  readonly riderId: string;
  readonly userId: string;
  readonly distanceM: number;
  readonly cashHeldCentavos: Centavos;
  readonly cashLimitCentavos: Centavos;
}

export type OfferAnswer = "accepted" | "declined";

export interface IDispatchRepository {
  job(orderId: string): Promise<DispatchJob | null>;
  /** Free, online riders near the pickup, nearest first, minus riders already offered this order. */
  candidates(job: DispatchJob, maxDistanceM: number): Promise<RiderCandidate[]>;
  /**
   * Offers the job, only while the order has no rider and no open offer; counts the attempt and
   * marks the order "offered". Null when someone else got there first.
   */
  createOffer(input: {
    readonly orderId: string;
    readonly riderId: string;
    readonly earningsCentavos: Centavos;
    readonly expiresAt: Date;
  }): Promise<string | null>;
  /** Expires open offers past their time; returns their order ids. */
  expireDue(now: Date): Promise<string[]>;
  /** Accepted/preparing/ready orders with no rider and no open offer. */
  awaitingDispatch(): Promise<string[]>;
  /** Marks the order unassigned for the zone coordinator (once) and queues their alert. */
  flag(orderId: string, now: Date): Promise<boolean>;
  /**
   * Answers an open offer of this rider. Accepting assigns the rider and fixes their pay on the
   * order, only if the offer is still open and unexpired.
   */
  respond(input: {
    readonly offerId: string;
    readonly riderId: string;
    readonly answer: OfferAnswer;
    readonly now: Date;
  }): Promise<{ readonly orderId: string } | "not_found" | "closed">;
}

/** Chooses the rider to offer a job to (OCP: a new rule is a new strategy). */
export interface IDispatchStrategy {
  choose(job: DispatchJob, candidates: readonly RiderCandidate[]): RiderCandidate | null;
}

/** What a rider earns for a job (shown on the offer). */
export interface IRiderPayRule {
  payFor(job: DispatchJob, settings: DispatchSettings): Centavos;
}

// ---------------------------------------------------------------------------
// The rider's side
// ---------------------------------------------------------------------------

export interface RiderProfile {
  readonly id: string;
  readonly userId: string;
  readonly zoneId: string;
  readonly status: "pending_kyc" | "active" | "suspended";
  readonly isOnline: boolean;
  readonly fullName: string | null;
  readonly vehicleType: VehicleType;
  readonly plateNo: string | null;
  readonly cashLimitCentavos: Centavos;
}

/** An offer as the rider sees it: where, how far and the pay; the address comes after accepting. */
export interface RiderOffer {
  readonly offerId: string;
  readonly orderId: string;
  readonly code: string;
  readonly storeName: string;
  readonly storeAddress: string | null;
  readonly pickup: GeoPoint;
  /** Road distance store → drop-off, and the drop-off's area only (barangay or city). */
  readonly tripMeters: number;
  readonly dropoffArea: string | null;
  readonly earningsCentavos: Centavos;
  readonly tipCentavos: Centavos;
  readonly cashToCollectCentavos: Centavos;
  readonly expiresAt: Date;
}

/** The job a rider is on. */
export interface RiderJob {
  readonly orderId: string;
  readonly code: string;
  readonly status: OrderStatus;
  readonly arrivedStoreAt: Date | null;
  readonly store: {
    readonly name: string;
    readonly address: string | null;
    readonly location: GeoPoint;
  };
  readonly dropoff: {
    readonly location: GeoPoint;
    readonly label: string | null;
    readonly street: string | null;
    readonly landmark: string | null;
    readonly barangay: string | null;
    readonly notes: string | null;
  };
  readonly contactPhone: string | null;
  readonly paymentMethod: PaymentMethod;
  readonly totalCentavos: Centavos;
  readonly tipCentavos: Centavos;
  readonly earningsCentavos: Centavos;
  readonly pinRequired: boolean;
  readonly items: readonly { readonly name: string; readonly quantity: number }[];
}

/** Money facts for settling a delivered order. */
export interface SettlementFacts {
  readonly orderId: string;
  readonly customerId: string;
  readonly merchantId: string;
  readonly paidOnline: boolean;
  readonly subtotalCentavos: Centavos;
  readonly deliveryFeeCentavos: Centavos;
  readonly serviceFeeCentavos: Centavos;
  readonly smallOrderFeeCentavos: Centavos;
  readonly tipCentavos: Centavos;
  readonly discountCentavos: Centavos;
  readonly discountFundedBy: "platform" | "merchant";
  readonly commissionBps: number;
  /** Founding stores pay no commission until this date. */
  readonly commissionFreeUntil: Date | null;
  readonly riderPayCentavos: Centavos;
}

export interface IRiderRepository {
  riderForUser(userId: string): Promise<RiderProfile | null>;
  setOnline(riderId: string, online: boolean): Promise<void>;
  /** Stores the latest position unless the last one is younger than `minIntervalMs` (throttle). */
  saveLocation(
    riderId: string,
    point: GeoPoint & {
      readonly heading?: number;
      readonly speedKph?: number;
      readonly accuracyM?: number;
    },
    now: Date,
    minIntervalMs: number,
  ): Promise<boolean>;
  addBreadcrumb(riderId: string, orderId: string, point: GeoPoint, now: Date): Promise<void>;
  currentOffer(riderId: string, now: Date): Promise<RiderOffer | null>;
  activeJob(riderId: string): Promise<RiderJob | null>;
  markArrivedAtStore(orderId: string, riderId: string, now: Date): Promise<boolean>;
  /** ready → picked_up as this rider (conditional); false when the order is not ready. */
  pickUp(orderId: string, riderId: string, riderUserId: string): Promise<boolean>;
  /** picked_up → delivered with the proof and the settlement, in one transaction. */
  deliver(input: {
    readonly orderId: string;
    readonly riderId: string;
    readonly riderUserId: string;
    readonly proofPath: string | null;
    readonly ledger: LedgerTxn;
  }): Promise<boolean>;
  deliveryPin(orderId: string): Promise<string | null>;
  settlementFacts(orderId: string): Promise<SettlementFacts | null>;
  /** COD cash the rider holds (collected and not yet remitted). */
  cashHeld(riderId: string): Promise<Centavos>;
  /** Delivered jobs since `from`: count, pay and tips. */
  earningsSince(
    riderId: string,
    from: Date,
  ): Promise<{
    readonly jobs: number;
    readonly payCentavos: Centavos;
    readonly tipCentavos: Centavos;
  }>;
}

/** Private storage for delivery photos (returns the stored path). */
export interface IDeliveryProofStorage {
  save(
    orderId: string,
    photo: { readonly bytes: Uint8Array; readonly contentType: string },
  ): Promise<string>;
}

/** Customer tracking facts. */
export interface TrackingFacts {
  readonly orderId: string;
  readonly customerId: string;
  readonly merchantId: string;
  readonly zoneId: string;
  readonly status: OrderStatus;
  readonly store: GeoPoint;
  readonly dropoff: GeoPoint;
  readonly readyBy: Date | null;
  readonly rider: {
    readonly firstName: string | null;
    readonly vehicleType: VehicleType;
    readonly plateNo: string | null;
    readonly location: GeoPoint | null;
    readonly locationAt: Date | null;
  } | null;
}

export interface ITrackingRepository {
  facts(orderId: string): Promise<TrackingFacts | null>;
}
