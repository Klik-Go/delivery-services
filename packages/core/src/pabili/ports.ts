import type { CheckoutAddress, OrderStatus, PabiliItemStatus } from "@klikgo/types";
import type { ZoneFees } from "../catalog/ports";
import type { GeoPoint } from "../merchant/ports";
import type { AppError } from "../shared/errors";
import type { Centavos } from "../shared/money";
import type { Result } from "../shared/result";

/** The admin setting `pabili` (docs/OPEN_QUESTIONS.md Q38). */
export interface PabiliSettings {
  readonly enabled: boolean;
  /** The most a customer may budget for the items. */
  readonly maxItemCentavos: Centavos;
  /** The Pabili fee, on top of the delivery fee. */
  readonly serviceFeeCentavos: Centavos;
  readonly maxItems: number;
  /** The longest shop → drop-off trip. */
  readonly maxTripM: number;
}

export const DEFAULT_PABILI_SETTINGS: PabiliSettings = {
  enabled: false,
  maxItemCentavos: 150_000,
  serviceFeeCentavos: 4_900,
  maxItems: 20,
  maxTripM: 5_000,
};

export interface IPabiliSettings {
  current(): Promise<PabiliSettings>;
}

/** One line of the shopping list. */
export interface PabiliLine {
  readonly position: number;
  readonly description: string;
  readonly quantity: number;
  readonly note: string | null;
  readonly status: PabiliItemStatus;
}

/** What is stored when a customer places a Pabili order. */
export interface NewPabiliOrder {
  readonly customerId: string;
  readonly zoneId: string;
  readonly storeName: string;
  readonly storeNotes: string | null;
  readonly pickup: GeoPoint;
  readonly dropoff: GeoPoint;
  readonly address: CheckoutAddress;
  readonly budgetCentavos: Centavos;
  readonly deliveryFeeCentavos: Centavos;
  readonly serviceFeeCentavos: Centavos;
  /** Fees only: the item cost is added at the door from the receipt. */
  readonly totalCentavos: Centavos;
  readonly lines: readonly Omit<PabiliLine, "status">[];
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

/** A stored Pabili order, as the services need it. */
export interface PabiliRecord {
  readonly orderId: string;
  readonly code: string;
  readonly customerId: string;
  readonly zoneId: string;
  readonly riderId: string | null;
  readonly status: OrderStatus;
  readonly storeName: string;
  readonly storeNotes: string | null;
  readonly pickup: GeoPoint;
  readonly budgetCentavos: Centavos;
  readonly deliveryFeeCentavos: Centavos;
  readonly serviceFeeCentavos: Centavos;
  readonly totalCentavos: Centavos;
  readonly itemCostCentavos: Centavos | null;
  readonly receiptPath: string | null;
  readonly boughtAt: Date | null;
  readonly requestHash: string | null;
  readonly createdAt: Date;
  readonly lines: readonly PabiliLine[];
}

export type CreatePabiliResult =
  | { readonly kind: "created"; readonly id: string; readonly code: string }
  | { readonly kind: "duplicate" };

export interface IPabiliRepository {
  /** The delivery pricing of a zone. */
  zoneFees(zoneId: string): Promise<ZoneFees | null>;
  /**
   * Stores the order, its request and list, placed by the customer and taken by Klik Go at once
   * (placed → accepted as the system) in one transaction. "duplicate" when the customer already
   * used this Idempotency-Key.
   */
  create(order: NewPabiliOrder): Promise<CreatePabiliResult>;
  findByIdempotencyKey(customerId: string, key: string): Promise<PabiliRecord | null>;
  find(orderId: string): Promise<PabiliRecord | null>;
  /** accepted → preparing as this rider (and arrived at the shop); false if no longer so. */
  startShopping(input: {
    readonly orderId: string;
    readonly riderId: string;
    readonly riderUserId: string;
    readonly now: Date;
  }): Promise<boolean>;
  /** preparing → ready as this rider with the cost, receipt and each line's outcome. */
  recordPurchase(input: {
    readonly orderId: string;
    readonly riderId: string;
    readonly riderUserId: string;
    readonly itemCostCentavos: Centavos;
    readonly receiptPath: string;
    readonly lines: readonly { readonly position: number; readonly status: PabiliItemStatus }[];
    readonly now: Date;
  }): Promise<boolean>;
  setFloat(riderId: string, floatCentavos: Centavos): Promise<void>;
}

/** Private storage for receipt photos, opened only through short-lived links. */
export interface IReceiptStorage {
  save(
    orderId: string,
    photo: { readonly bytes: Uint8Array; readonly contentType: string },
  ): Promise<Result<string, AppError>>;
  signedUrl(path: string, expiresInSeconds: number): Promise<string | null>;
}
