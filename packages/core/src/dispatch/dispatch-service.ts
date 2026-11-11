import type { OrderStatus } from "@klikgo/types";
import type { NotificationMessage } from "../notifications/ports";
import type { NotifiableOrder } from "../notifications/notification-service";
import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import { ConflictError, NotFoundError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type {
  DispatchJob,
  IDispatchRepository,
  IDispatchSettingsSource,
  IDispatchStrategy,
  IRiderPayRule,
  OfferAnswer,
} from "./ports";

/** Orders a rider can still be found for: the store took them and the food is not gone yet. */
const DISPATCHABLE: readonly OrderStatus[] = ["accepted", "preparing", "ready"];

export type DispatchOutcome =
  | {
      readonly kind: "offered";
      readonly offerId: string;
      readonly riderId: string;
      readonly expiresAt: Date;
    }
  | { readonly kind: "flagged" }
  | { readonly kind: "waiting" }
  | { readonly kind: "skipped" };

/** What one dispatch tick did. */
export interface DispatchTick {
  readonly expired: number;
  readonly offered: number;
  readonly flagged: number;
}

/** Reads the facts a message about an order needs (the order repository). */
export interface INotifiableOrders {
  findById(orderId: string): Promise<NotifiableOrder | null>;
}

/** Sends one message (NotificationService). */
export interface IMessageSender {
  notify(message: NotificationMessage): Promise<void>;
}

/**
 * Finds riders for orders (docs/BUSINESS.md §5.3, BUILD_PLAN Phase 7). One rider at a time gets
 * a 30-second offer with the pay shown upfront; a decline or an expiry moves the job to the next
 * rider straight away (the background job runs every 10 seconds). After the configured number of
 * offers, or when nobody is left nearby, the zone coordinator is told, and dispatch keeps trying
 * riders who come online. Which rider and what pay are strategies (OCP).
 */
export class DispatchService {
  constructor(
    private readonly deps: {
      repo: IDispatchRepository;
      settings: IDispatchSettingsSource;
      strategy: IDispatchStrategy;
      payRule: IRiderPayRule;
      orders: INotifiableOrders;
      messages: IMessageSender;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  /** Called when the store accepts: starts dispatch now unless it should wait until nearer ready. */
  async orderAccepted(orderId: string): Promise<void> {
    await this.dispatch(orderId);
  }

  /** Offers the order to the next rider, or tells the coordinator nobody is left. */
  async dispatch(orderId: string): Promise<DispatchOutcome> {
    const now = this.deps.clock.now();
    const settings = await this.deps.settings.load();
    const job = await this.deps.repo.job(orderId);
    if (!job || job.riderId || job.hasOpenOffer || !DISPATCHABLE.includes(job.status)) {
      return { kind: "skipped" };
    }
    if (this.tooEarly(job, settings.start, settings.leadMinutes, now)) return { kind: "waiting" };

    const candidates = await this.deps.repo.candidates(job, settings.maxDistanceM);
    const rider = this.deps.strategy.choose(job, candidates);
    // Out of attempts: the coordinator steps in, but riders who come free still get offers.
    if (!rider || job.attempts >= settings.maxAttempts) await this.flag(job, now);
    if (!rider) return { kind: "flagged" };

    const earningsCentavos = this.deps.payRule.payFor(job, settings);
    const expiresAt = new Date(now.getTime() + settings.offerSeconds * 1000);
    const offerId = await this.deps.repo.createOffer({
      orderId,
      riderId: rider.riderId,
      earningsCentavos,
      expiresAt,
    });
    if (!offerId) return { kind: "skipped" };
    this.deps.logger.info("dispatch.offered", {
      orderId,
      riderId: rider.riderId,
      attempt: job.attempts + 1,
      distanceM: Math.round(rider.distanceM),
    });
    await this.deps.messages.notify({
      userId: rider.userId,
      template: "rider_offer",
      orderId,
      params: { store: job.merchantName, earningsCentavos, seconds: settings.offerSeconds },
    });
    return { kind: "offered", offerId, riderId: rider.riderId, expiresAt };
  }

  /** A rider answers their offer. A decline sends the job on to the next rider at once. */
  async respond(
    riderId: string,
    offerId: string,
    answer: OfferAnswer,
  ): Promise<Result<{ readonly orderId: string }, AppError>> {
    const now = this.deps.clock.now();
    const outcome = await this.deps.repo.respond({ offerId, riderId, answer, now });
    if (outcome === "not_found") return err(new NotFoundError("Offer", offerId));
    if (outcome === "closed") {
      return err(new ConflictError("This offer has ended. Watch for the next one."));
    }
    this.deps.logger.info(`dispatch.${answer}`, { orderId: outcome.orderId, riderId });
    if (answer === "declined") {
      await this.dispatch(outcome.orderId);
    } else {
      const order = await this.deps.orders.findById(outcome.orderId);
      if (order) {
        await this.deps.messages.notify({
          userId: order.customerId,
          template: "order_rider_assigned",
          orderId: order.id,
          params: { orderId: order.id, code: order.code, store: order.merchantName },
        });
      }
    }
    return ok(outcome);
  }

  /** Background job: expire unanswered offers, then find riders for every order still waiting. */
  async tick(): Promise<DispatchTick> {
    const now = this.deps.clock.now();
    const expired = await this.deps.repo.expireDue(now);
    const waiting = new Set([...expired, ...(await this.deps.repo.awaitingDispatch())]);
    let offered = 0;
    let flagged = 0;
    for (const orderId of waiting) {
      try {
        const outcome = await this.dispatch(orderId);
        if (outcome.kind === "offered") offered += 1;
        if (outcome.kind === "flagged") flagged += 1;
      } catch (error) {
        // One order failing must not hold up the others.
        this.deps.logger.error("dispatch.failed", {
          orderId,
          err: error instanceof Error ? error.name : "unknown",
        });
      }
    }
    return { expired: expired.length, offered, flagged };
  }

  private tooEarly(
    job: DispatchJob,
    start: "accept" | "before_ready",
    leadMinutes: number,
    now: Date,
  ): boolean {
    if (start === "accept" || !job.readyBy || job.status === "ready") return false;
    return now.getTime() < job.readyBy.getTime() - leadMinutes * 60_000;
  }

  private async flag(job: DispatchJob, now: Date): Promise<void> {
    if (job.flaggedAt) return;
    if (await this.deps.repo.flag(job.id, now)) {
      this.deps.logger.warn("dispatch.unassigned", { orderId: job.id, attempts: job.attempts });
    }
  }
}
