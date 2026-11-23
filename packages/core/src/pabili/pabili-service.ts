import type {
  PabiliItemStatus,
  PabiliPurchaseInput,
  PabiliQuoteRequest,
  PlacePabiliRequest,
} from "@klikgo/types";
import type { AuthorizationService } from "../auth/authorization-service";
import type { SessionUser } from "../auth/session-user";
import { roadMeters } from "../catalog/geo";
import type { IServiceArea } from "../catalog/ports";
import type { PricingService } from "../catalog/pricing-service";
import type { IRiderRepository, RiderProfile } from "../dispatch/ports";
import type { OrderStateMachine } from "../ordering/order-state-machine";
import type { IContentHasher } from "../ordering/ports";
import { INVITE_ONLY_MESSAGE } from "../pilot/invite-service";
import type { IOrderingAccess } from "../pilot/ports";
import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
  type AppError,
} from "../shared/errors";
import { verifiedFileType } from "../shared/file-type";
import type { Centavos } from "../shared/money";
import { err, ok, type Result } from "../shared/result";
import type {
  IPabiliRepository,
  IPabiliSettings,
  IReceiptStorage,
  PabiliLine,
  PabiliRecord,
  PabiliSettings,
} from "./ports";

/** Shown while the admin has Pabili switched off. */
export const PABILI_OFF_MESSAGE = "Pabili isn't available right now. Order from a store instead.";
/** Receipt links last five minutes. */
export const RECEIPT_URL_SECONDS = 300;
const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** What the Pabili form needs to know (public). */
export interface PabiliOptions {
  readonly enabled: boolean;
  readonly maxItemCentavos: Centavos;
  readonly serviceFeeCentavos: Centavos;
  readonly maxItems: number;
}

/** The fees for a shopping list. The customer pays the receipt total on top, at the door. */
export interface PabiliQuote {
  readonly zoneId: string;
  readonly distanceMeters: number;
  readonly budgetCentavos: Centavos;
  readonly deliveryFeeCentavos: Centavos;
  readonly serviceFeeCentavos: Centavos;
  /** Delivery + Pabili fee: the order total before the items. */
  readonly feesCentavos: Centavos;
  /** The most the customer can be asked for at the door (budget + fees). */
  readonly maxToPayCentavos: Centavos;
  /** True while the pilot is invite-only and this customer has not redeemed a code yet. */
  readonly inviteRequired: boolean;
}

export interface PlacedPabili {
  readonly orderId: string;
  readonly code: string;
  readonly totalCentavos: Centavos;
}

/** A Pabili order as its customer, the rider, the zone's coordinator or an admin sees it. */
export interface PabiliView {
  readonly orderId: string;
  readonly code: string;
  readonly status: PabiliRecord["status"];
  readonly storeName: string;
  readonly storeNotes: string | null;
  readonly budgetCentavos: Centavos;
  readonly feesCentavos: Centavos;
  readonly itemCostCentavos: Centavos | null;
  /** Receipt total + fees once bought; null before. */
  readonly toPayCentavos: Centavos | null;
  readonly boughtAt: string | null;
  /** A five-minute link to the receipt photo, once bought. */
  readonly receiptUrl: string | null;
  readonly lines: readonly PabiliLine[];
}

const invalid = (path: string, message: string): ValidationError =>
  new ValidationError(message, [{ path, message }]);

/**
 * Pabili, "buy for me" (docs/BUILD_PLAN.md §4 and Phase 13; Q38): the customer sends a shopping
 * list for any shop, palengke or sari-sari store with a budget; a rider whose float covers it buys
 * the items, records the receipt total (never more than the budget) with a photo, and delivers. The
 * customer pays the receipt plus the delivery and Pabili fees in cash. There is no store, so Klik
 * Go takes the order at once and dispatch starts straight away. Every status change goes through
 * {@link OrderStateMachine} (Pabili rules) and the database writes order_events.
 */
export class PabiliService {
  constructor(
    private readonly deps: {
      settings: IPabiliSettings;
      pabili: IPabiliRepository;
      receipts: IReceiptStorage;
      serviceArea: IServiceArea;
      pricing: PricingService;
      riders: IRiderRepository;
      dispatch: { orderAccepted(orderId: string): Promise<void> };
      states: OrderStateMachine;
      authz: AuthorizationService;
      hasher: IContentHasher;
      clock: Clock;
      logger: Logger;
      /** The invite gate (invite_only). Open when not wired. */
      access?: IOrderingAccess;
    },
  ) {}

  async options(): Promise<PabiliOptions> {
    const s = await this.deps.settings.current();
    return {
      enabled: s.enabled,
      maxItemCentavos: s.maxItemCentavos,
      serviceFeeCentavos: s.serviceFeeCentavos,
      maxItems: s.maxItems,
    };
  }

  /** Prices a shopping list: delivery fee for the shop → drop-off trip plus the Pabili fee. */
  async quote(
    input: PabiliQuoteRequest,
    actor: SessionUser | null,
  ): Promise<Result<PabiliQuote, AppError>> {
    const settings = await this.deps.settings.current();
    if (!settings.enabled) return err(new ServiceUnavailableError(PABILI_OFF_MESSAGE));
    if (input.items.length > settings.maxItems) {
      return err(
        invalid("items", `A Pabili list can have up to ${String(settings.maxItems)} items.`),
      );
    }
    if (input.budgetCentavos > settings.maxItemCentavos) {
      return err(
        invalid(
          "budgetCentavos",
          `The most a rider can spend on items is ₱${String(settings.maxItemCentavos / 100)}.`,
        ),
      );
    }
    const [shopZone, dropZone] = await Promise.all([
      this.deps.serviceArea.zoneFor(input.pickup),
      this.deps.serviceArea.zoneFor(input.dropoff),
    ]);
    if (!dropZone) return err(invalid("dropoff", "We don't deliver to your pin yet."));
    if (shopZone?.id !== dropZone.id) {
      return err(invalid("pickup", "The shop has to be in your delivery area."));
    }
    const distanceMeters = roadMeters(input.pickup, input.dropoff);
    if (distanceMeters > settings.maxTripM) {
      return err(
        invalid(
          "pickup",
          `The shop is too far from you. Pick one within ${String(settings.maxTripM / 1000)} km.`,
        ),
      );
    }
    const fees = await this.deps.pabili.zoneFees(dropZone.id);
    if (!fees) return err(invalid("dropoff", "We don't deliver to your pin yet."));
    const deliveryFeeCentavos = await this.deps.pricing.tripFee(fees, distanceMeters);
    const feesCentavos = deliveryFeeCentavos + settings.serviceFeeCentavos;
    const inviteRequired = actor ? !(await this.canOrder(actor.id)) : false;
    return ok({
      zoneId: dropZone.id,
      distanceMeters,
      budgetCentavos: input.budgetCentavos,
      deliveryFeeCentavos,
      serviceFeeCentavos: settings.serviceFeeCentavos,
      feesCentavos,
      maxToPayCentavos: feesCentavos + input.budgetCentavos,
      inviteRequired,
    });
  }

  /** Places the order once per Idempotency-Key; Klik Go takes it and dispatch starts at once. */
  async place(
    input: PlacePabiliRequest,
    context: { readonly idempotencyKey: string; readonly actor: SessionUser },
  ): Promise<Result<PlacedPabili, AppError>> {
    const { actor, idempotencyKey } = context;
    if (!this.deps.authz.can(actor, { type: "order.place" })) return err(new ForbiddenError());
    if (!(await this.canOrder(actor.id))) return err(new ForbiddenError(INVITE_ONLY_MESSAGE));
    const requestHash = this.deps.hasher.sha256Hex(canonical(input));

    const existing = await this.deps.pabili.findByIdempotencyKey(actor.id, idempotencyKey);
    if (existing) return replay(existing, requestHash);

    const quoted = await this.quote(input, actor);
    if (!quoted.ok) return quoted;
    const q = quoted.value;
    const stored = await this.deps.pabili.create({
      customerId: actor.id,
      zoneId: q.zoneId,
      storeName: input.storeName,
      storeNotes: input.storeNotes ?? null,
      pickup: input.pickup,
      dropoff: input.dropoff,
      address: input.address,
      budgetCentavos: q.budgetCentavos,
      deliveryFeeCentavos: q.deliveryFeeCentavos,
      serviceFeeCentavos: q.serviceFeeCentavos,
      totalCentavos: q.feesCentavos,
      lines: input.items.map((line, i) => ({
        position: i + 1,
        description: line.description,
        quantity: line.quantity,
        note: line.note ? line.note : null,
      })),
      idempotencyKey,
      requestHash,
    });
    if (stored.kind === "duplicate") {
      const raced = await this.deps.pabili.findByIdempotencyKey(actor.id, idempotencyKey);
      if (!raced) return err(new ConflictError("Please try placing the order again."));
      return replay(raced, requestHash);
    }
    this.deps.logger.info("pabili.created", {
      orderId: stored.id,
      zoneId: q.zoneId,
      budgetCentavos: q.budgetCentavos,
      lines: input.items.length,
    });
    try {
      await this.deps.dispatch.orderAccepted(stored.id);
    } catch (error) {
      // The order stands; the background job looks for a rider within seconds.
      this.deps.logger.error("dispatch.start_failed", {
        orderId: stored.id,
        err: error instanceof Error ? error.name : "unknown",
      });
    }
    return ok({ orderId: stored.id, code: stored.code, totalCentavos: q.feesCentavos });
  }

  /** The list, money and receipt for the customer, the rider on it, the zone's staff or admins. */
  async view(user: SessionUser | null, orderId: string): Promise<Result<PabiliView, AppError>> {
    if (!user) return err(new UnauthorizedError());
    const order = await this.deps.pabili.find(orderId);
    if (!order || !(await this.maySee(user, order))) {
      return err(new NotFoundError("Order", orderId));
    }
    const receiptUrl = order.receiptPath
      ? await this.deps.receipts.signedUrl(order.receiptPath, RECEIPT_URL_SECONDS)
      : null;
    if (order.receiptPath) {
      this.deps.logger.info("pabili.receipt_viewed", { orderId, userId: user.id });
    }
    return ok(toView(order, receiptUrl));
  }

  /** The rider is at the shop and starts shopping (accepted → preparing). */
  async startShopping(
    user: SessionUser | null,
    orderId: string,
  ): Promise<Result<PabiliView, AppError>> {
    const job = await this.riderJob(user, orderId);
    if (!job.ok) return job;
    const { rider, order } = job.value;
    if (order.status === "preparing") return ok(toView(order, null));
    const allowed = this.deps.states.check(order.status, "preparing", "rider", "pabili");
    if (!allowed.ok) return allowed;
    const started = await this.deps.pabili.startShopping({
      orderId,
      riderId: rider.id,
      riderUserId: rider.userId,
      now: this.deps.clock.now(),
    });
    if (!started) return err(new ConflictError("This job was just changed. Refresh to see it."));
    this.deps.logger.info("order.status_changed", {
      orderId,
      from: order.status,
      to: "preparing",
      role: "rider",
    });
    return this.reload(orderId);
  }

  /**
   * The rider records the purchase: each line bought or unavailable, the receipt total (never
   * above the customer's budget) and a photo of the receipt (preparing → ready).
   */
  async recordPurchase(
    user: SessionUser | null,
    orderId: string,
    input: PabiliPurchaseInput,
    photo: { readonly bytes: Uint8Array; readonly contentType: string } | null,
  ): Promise<Result<PabiliView, AppError>> {
    const job = await this.riderJob(user, orderId);
    if (!job.ok) return job;
    const { rider, order } = job.value;
    const allowed = this.deps.states.check(order.status, "ready", "rider", "pabili");
    if (!allowed.ok) {
      return err(
        order.status === "accepted"
          ? new ConflictError("Start shopping first.")
          : new ConflictError("This purchase is already recorded."),
      );
    }
    const lines = checkLines(order.lines, input.items);
    if (!lines.ok) return lines;
    const bought = lines.value.some((line) => line.status === "bought");
    if (!bought && input.itemCostCentavos > 0) {
      return err(invalid("itemCostCentavos", "Nothing was bought, so the cost must be ₱0."));
    }
    if (bought && input.itemCostCentavos === 0) {
      return err(invalid("itemCostCentavos", "Enter the total on the receipt."));
    }
    if (input.itemCostCentavos > order.budgetCentavos) {
      return err(
        invalid(
          "itemCostCentavos",
          `That's over the customer's budget of ₱${String(order.budgetCentavos / 100)}. Call the customer and leave something out.`,
        ),
      );
    }
    if (!photo) return err(invalid("receipt", "Take a photo of the receipt."));
    if (!verifiedFileType(photo.bytes, photo.contentType, RECEIPT_TYPES)) {
      return err(invalid("receipt", "That file is not a photo. Take a photo of the receipt."));
    }
    const saved = await this.deps.receipts.save(orderId, photo);
    if (!saved.ok) return saved;
    const recorded = await this.deps.pabili.recordPurchase({
      orderId,
      riderId: rider.id,
      riderUserId: rider.userId,
      itemCostCentavos: input.itemCostCentavos,
      receiptPath: saved.value,
      lines: lines.value,
      now: this.deps.clock.now(),
    });
    if (!recorded) return err(new ConflictError("This job was just changed. Refresh to see it."));
    this.deps.logger.info("order.status_changed", {
      orderId,
      from: "preparing",
      to: "ready",
      role: "rider",
      itemCostCentavos: input.itemCostCentavos,
    });
    return this.reload(orderId);
  }

  /** The rider sets how much cash they can spend up front (0 = no Pabili jobs). */
  async setFloat(
    user: SessionUser | null,
    floatCentavos: Centavos,
  ): Promise<Result<{ readonly floatCentavos: Centavos }, AppError>> {
    const rider = await this.rider(user);
    if (!rider.ok) return rider;
    if (floatCentavos > rider.value.cashLimitCentavos) {
      return err(
        invalid(
          "floatCentavos",
          `Your float can't be more than your cash limit of ₱${String(rider.value.cashLimitCentavos / 100)}.`,
        ),
      );
    }
    await this.deps.pabili.setFloat(rider.value.id, floatCentavos);
    this.deps.logger.info("rider.pabili_float_changed", { riderId: rider.value.id, floatCentavos });
    return ok({ floatCentavos });
  }

  private async maySee(user: SessionUser, order: PabiliRecord): Promise<boolean> {
    if (
      this.deps.authz.can(user, {
        type: "order.view",
        customerId: order.customerId,
        merchantId: null,
        zoneId: order.zoneId,
      })
    ) {
      return true;
    }
    if (!order.riderId || !user.roles.some((g) => g.role === "rider")) return false;
    const rider = await this.deps.riders.riderForUser(user.id);
    return rider?.id === order.riderId;
  }

  private async riderJob(
    user: SessionUser | null,
    orderId: string,
  ): Promise<Result<{ readonly rider: RiderProfile; readonly order: PabiliRecord }, AppError>> {
    const rider = await this.rider(user);
    if (!rider.ok) return rider;
    const order = await this.deps.pabili.find(orderId);
    // Someone else's job reads as missing, so order ids cannot be probed.
    if (order?.riderId !== rider.value.id) return err(new NotFoundError("Job", orderId));
    return ok({ rider: rider.value, order });
  }

  private async rider(user: SessionUser | null): Promise<Result<RiderProfile, AppError>> {
    if (!user) return err(new UnauthorizedError());
    if (!user.roles.some((grant) => grant.role === "rider")) return err(new ForbiddenError());
    const rider = await this.deps.riders.riderForUser(user.id);
    if (!rider) return err(new ForbiddenError("Finish your rider sign-up first."));
    if (rider.status === "suspended") {
      return err(new ForbiddenError("Your rider account is on hold. Please contact support."));
    }
    return ok(rider);
  }

  private async reload(orderId: string): Promise<Result<PabiliView, AppError>> {
    const order = await this.deps.pabili.find(orderId);
    if (!order) return err(new NotFoundError("Order", orderId));
    return ok(toView(order, null));
  }

  private canOrder(userId: string): Promise<boolean> {
    return this.deps.access ? this.deps.access.canOrder(userId) : Promise.resolve(true);
  }
}

/** Every line of the list must be answered exactly once. */
function checkLines(
  lines: readonly PabiliLine[],
  answers: PabiliPurchaseInput["items"],
): Result<{ position: number; status: Exclude<PabiliItemStatus, "pending"> }[], AppError> {
  const positions = new Set(lines.map((line) => line.position));
  const seen = new Set<number>();
  for (const answer of answers) {
    if (!positions.has(answer.position) || seen.has(answer.position)) {
      return err(invalid("items", "Mark each item on the list once, as bought or not available."));
    }
    seen.add(answer.position);
  }
  if (seen.size !== positions.size) {
    return err(invalid("items", "Mark every item on the list as bought or not available."));
  }
  return ok(answers.map((a) => ({ position: a.position, status: a.status })));
}

function replay(existing: PabiliRecord, requestHash: string): Result<PlacedPabili, AppError> {
  if (existing.requestHash !== requestHash) {
    return err(new ConflictError("This checkout was already used for a different order."));
  }
  return ok({
    orderId: existing.orderId,
    code: existing.code,
    totalCentavos: existing.totalCentavos,
  });
}

function toView(order: PabiliRecord, receiptUrl: string | null): PabiliView {
  return {
    orderId: order.orderId,
    code: order.code,
    status: order.status,
    storeName: order.storeName,
    storeNotes: order.storeNotes,
    budgetCentavos: order.budgetCentavos,
    feesCentavos: order.totalCentavos,
    itemCostCentavos: order.itemCostCentavos,
    toPayCentavos:
      order.itemCostCentavos === null ? null : order.itemCostCentavos + order.totalCentavos,
    boughtAt: order.boughtAt ? order.boughtAt.toISOString() : null,
    receiptUrl,
    lines: order.lines,
  };
}

/** A stable text form of the request, so a retry with the same list hashes the same. */
function canonical(input: PlacePabiliRequest): string {
  return JSON.stringify({
    storeName: input.storeName,
    storeNotes: input.storeNotes ?? null,
    pickup: [input.pickup.lat, input.pickup.lng],
    dropoff: [input.dropoff.lat, input.dropoff.lng],
    budgetCentavos: input.budgetCentavos,
    items: input.items.map((line) => [line.description, line.quantity, line.note ?? null]),
    address: Object.fromEntries(
      Object.entries(input.address).sort(([a], [b]) => a.localeCompare(b)),
    ),
  });
}
