import type { DispatchTick } from "../dispatch/dispatch-service";
import type { Logger } from "../ports/logger";
import type { IOrderLifecycleRepository } from "./ports";
import type { RefundService } from "./refund-service";

/** What one run of the background jobs did. */
export interface JobsRun {
  readonly notifications: number;
  readonly refundsStarted: number;
  readonly refundsFailed: number;
  /** Offers that expired, offers made and orders flagged for the coordinator. */
  readonly dispatch: DispatchTick;
}

const NO_DISPATCH: DispatchTick = { expired: 0, offered: 0, flagged: 0 };

/**
 * Work the scheduler triggers every 10 seconds (docs/ARCHITECTURE.md §4g, §4h): move expired rider
 * offers on to the next rider, send the messages the database queued (SLA texts and alerts) and
 * refund paid orders that ended early but still hold the money (store timeouts cancelled by
 * pg_cron, or a refund that failed at the time). Safe to run twice at once: offers are conditional,
 * messages are claimed and refunds are reserved before anything is sent.
 */
export class BackgroundJobs {
  constructor(
    private readonly deps: {
      notifications: { deliverQueued(limit: number): Promise<number> };
      lifecycle: IOrderLifecycleRepository;
      refunds: RefundService;
      dispatch?: { tick(): Promise<DispatchTick> };
      logger: Logger;
      batchSize?: number;
    },
  ) {}

  async run(): Promise<JobsRun> {
    const limit = this.deps.batchSize ?? 50;
    const dispatch = await this.dispatchTick();
    const notifications = await this.deps.notifications.deliverQueued(limit);
    let refundsStarted = 0;
    let refundsFailed = 0;
    for (const due of await this.deps.lifecycle.refundsDue(limit)) {
      const refunded = await this.deps.refunds.refund(
        { orderId: due.orderId, reason: due.reason },
        "system",
      );
      if (refunded.ok) refundsStarted += 1;
      else {
        refundsFailed += 1;
        this.deps.logger.warn("jobs.refund_failed", {
          orderId: due.orderId,
          code: refunded.error.code,
        });
      }
    }
    if (notifications + refundsStarted + refundsFailed + dispatch.offered + dispatch.expired > 0) {
      this.deps.logger.info("jobs.run", {
        notifications,
        refundsStarted,
        refundsFailed,
        offersExpired: dispatch.expired,
        offersMade: dispatch.offered,
      });
    }
    return { notifications, refundsStarted, refundsFailed, dispatch };
  }

  /** Dispatch runs first (offers are time-critical) and a failure there must not stop the rest. */
  private async dispatchTick(): Promise<DispatchTick> {
    if (!this.deps.dispatch) return NO_DISPATCH;
    try {
      return await this.deps.dispatch.tick();
    } catch (error) {
      this.deps.logger.error("jobs.dispatch_failed", {
        err: error instanceof Error ? error.name : "unknown",
      });
      return NO_DISPATCH;
    }
  }
}
