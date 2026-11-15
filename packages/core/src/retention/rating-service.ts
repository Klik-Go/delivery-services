import type { CustomerRatingInput, RatingTargetKind, RiderRatingInput } from "@klikgo/types";
import type { SessionUser } from "../auth/session-user";
import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  type AppError,
} from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { IRatingRepository, RatableOrder, RatingRecord, RatingWrite } from "./ports";

/** Ratings open when the order is delivered and close 7 days later (docs/BUILD_PLAN.md Phase 9). */
export const RATING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** A rating can be changed for 24 hours after it was first given. */
export const RATING_EDIT_MS = 24 * 60 * 60 * 1000;
/** Ratings at or below this open a ticket for the zone's coordinator (docs/BUSINESS.md §5.3). */
export const LOW_RATING = 2;

/** One rating as its author sees it. */
export interface RatingView {
  readonly score: number;
  readonly tags: readonly string[];
  readonly comment: string | null;
  /** Until when it can still be changed (ISO time), or null once locked. */
  readonly editableUntil: string | null;
}

/** What the customer can rate on one order. */
export interface OrderRatingSheet {
  readonly orderId: string;
  /** True while ratings can be given or changed. */
  readonly open: boolean;
  readonly closesAt: string | null;
  readonly merchant: { readonly name: string; readonly rating: RatingView | null };
  readonly rider: { readonly name: string | null; readonly rating: RatingView | null } | null;
}

/** A delivery the rider can rate the customer for. */
export interface RiderDeliveryToRate {
  readonly orderId: string;
  readonly code: string;
  readonly merchantName: string;
  readonly deliveredAt: string;
  readonly rating: RatingView | null;
}

/** Score, tags and comment as the rater gave them. */
interface GivenRating {
  readonly score: number;
  readonly tags: readonly string[];
  readonly comment?: string | undefined;
}

const LABEL: Readonly<Record<RatingTargetKind, string>> = {
  merchant: "Store",
  rider: "Rider",
  customer: "Customer",
};

/**
 * Two-sided ratings (docs/BUSINESS.md §5.3, §9.2.1): after delivery the customer rates the store
 * and the rider separately, and the rider rates the customer. One rating per order and target,
 * given within 7 days of delivery and changeable for 24 hours. A rating of 2 or less opens a
 * ticket for the zone's coordinator. Averages are kept by the database.
 */
export class RatingService {
  constructor(
    private readonly deps: { ratings: IRatingRepository; clock: Clock; logger: Logger },
  ) {}

  /** The customer's rating sheet for one of their orders. */
  async sheet(
    user: SessionUser | null,
    orderId: string,
  ): Promise<Result<OrderRatingSheet, AppError>> {
    const found = await this.customerOrder(user, orderId);
    if (!found.ok) return found;
    const order = found.value;
    const mine = (await this.deps.ratings.ratings(orderId)).filter(
      (r) => r.fromUserId === order.customerId,
    );
    const view = (type: RatingTargetKind): RatingView | null => {
      const rating = mine.find((r) => r.targetType === type);
      return rating ? this.view(rating) : null;
    };
    const closes = order.deliveredAt
      ? new Date(order.deliveredAt.getTime() + RATING_WINDOW_MS)
      : null;
    return ok({
      orderId,
      open: this.isOpen(order),
      closesAt: closes ? closes.toISOString() : null,
      merchant: { name: order.merchantName, rating: view("merchant") },
      rider: order.riderId ? { name: order.riderName, rating: view("rider") } : null,
    });
  }

  /** The customer rates the store and/or the rider of a delivered order. */
  async rateOrder(
    user: SessionUser | null,
    orderId: string,
    input: CustomerRatingInput,
  ): Promise<Result<OrderRatingSheet, AppError>> {
    const found = await this.customerOrder(user, orderId);
    if (!found.ok) return found;
    const order = found.value;
    if (input.rider && !order.riderId) {
      return err(
        new ValidationError("This order had no rider to rate.", [
          { path: "rider", message: "No rider" },
        ]),
      );
    }
    const targets: [RatingTargetKind, string, GivenRating][] = [];
    if (input.merchant) targets.push(["merchant", order.merchantId, input.merchant]);
    if (input.rider && order.riderId) targets.push(["rider", order.riderId, input.rider]);
    const saved = await this.save(order, order.customerId, targets);
    if (!saved.ok) return saved;
    return this.sheet(user, orderId);
  }

  /** The rider's deliveries of the last 7 days, to rate the customers. */
  async riderDeliveries(
    user: SessionUser | null,
  ): Promise<Result<RiderDeliveryToRate[], AppError>> {
    if (!user) return err(new UnauthorizedError());
    const since = new Date(this.deps.clock.now().getTime() - RATING_WINDOW_MS);
    const rows = await this.deps.ratings.riderDeliveries(user.id, since);
    return ok(
      rows.map(({ order, rating }) => ({
        orderId: order.id,
        code: order.code,
        merchantName: order.merchantName,
        deliveredAt: (order.deliveredAt ?? since).toISOString(),
        rating: rating ? this.view(rating) : null,
      })),
    );
  }

  /** The rider rates the customer of an order they delivered. */
  async rateCustomer(
    user: SessionUser | null,
    orderId: string,
    input: RiderRatingInput,
  ): Promise<Result<RiderDeliveryToRate, AppError>> {
    if (!user) return err(new UnauthorizedError());
    const order = await this.deps.ratings.order(orderId);
    if (!order || order.riderUserId !== user.id) return err(new NotFoundError("Order", orderId));
    const saved = await this.save(order, user.id, [["customer", order.customerId, input]]);
    if (!saved.ok) return saved;
    const rating = saved.value[0] ?? null;
    return ok({
      orderId: order.id,
      code: order.code,
      merchantName: order.merchantName,
      deliveredAt: (order.deliveredAt ?? this.deps.clock.now()).toISOString(),
      rating: rating ? this.view(rating) : null,
    });
  }

  private async customerOrder(
    user: SessionUser | null,
    orderId: string,
  ): Promise<Result<RatableOrder, AppError>> {
    if (!user) return err(new UnauthorizedError());
    const order = await this.deps.ratings.order(orderId);
    // Other people's orders read as missing, so order ids cannot be probed.
    if (!order || order.customerId !== user.id) return err(new NotFoundError("Order", orderId));
    return ok(order);
  }

  private isOpen(order: RatableOrder): boolean {
    if (order.status !== "delivered" || !order.deliveredAt) return false;
    return this.deps.clock.now().getTime() - order.deliveredAt.getTime() <= RATING_WINDOW_MS;
  }

  /** Checks the windows for every target first, so nothing is half saved. */
  private async save(
    order: RatableOrder,
    fromUserId: string,
    targets: readonly [RatingTargetKind, string, GivenRating][],
  ): Promise<Result<RatingRecord[], AppError>> {
    if (order.status !== "delivered") {
      return err(new ConflictError("You can rate an order once it has been delivered."));
    }
    if (!this.isOpen(order)) {
      return err(new ConflictError("Ratings close 7 days after delivery."));
    }
    const existing = (await this.deps.ratings.ratings(order.id)).filter(
      (r) => r.fromUserId === fromUserId,
    );
    const now = this.deps.clock.now().getTime();
    for (const [type] of targets) {
      const before = existing.find((r) => r.targetType === type);
      if (before && now - before.createdAt.getTime() > RATING_EDIT_MS) {
        return err(
          new ConflictError(`Your ${LABEL[type].toLowerCase()} rating can no longer be changed.`),
        );
      }
    }
    const saved: RatingRecord[] = [];
    for (const [type, targetId, given] of targets) {
      const before = existing.find((r) => r.targetType === type);
      const low = given.score <= LOW_RATING && (!before || before.score > LOW_RATING);
      const write: RatingWrite = {
        orderId: order.id,
        fromUserId,
        targetType: type,
        targetId,
        score: given.score,
        tags: given.tags,
        comment: given.comment?.trim() ? given.comment.trim() : null,
        ticket: low
          ? {
              zoneId: order.zoneId,
              summary: ticketSummary(type, order, given.score, given.tags),
            }
          : null,
      };
      saved.push(await this.deps.ratings.save(write));
      this.deps.logger.info("rating.saved", {
        orderId: order.id,
        targetType: type,
        score: given.score,
        edited: before !== undefined,
        ticket: low,
      });
    }
    return ok(saved);
  }

  private view(rating: RatingRecord): RatingView {
    const until = rating.createdAt.getTime() + RATING_EDIT_MS;
    return {
      score: rating.score,
      tags: rating.tags,
      comment: rating.comment,
      editableUntil:
        this.deps.clock.now().getTime() <= until ? new Date(until).toISOString() : null,
    };
  }
}

/** One line for the coordinator; tags only, never the comment or anyone's details. */
function ticketSummary(
  type: RatingTargetKind,
  order: RatableOrder,
  score: number,
  tags: readonly string[],
): string {
  const who =
    type === "merchant"
      ? `Store ${order.merchantName}`
      : type === "rider"
        ? `Rider ${order.riderName ?? ""}`.trim()
        : "Customer";
  const tagText = tags.length > 0 ? ` (${tags.map((t) => t.replace(/_/g, " ")).join(", ")})` : "";
  return `${who} rated ${String(score)}/5 on ${order.code}${tagText}`.slice(0, 300);
}
