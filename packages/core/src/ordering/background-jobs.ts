import type { Logger } from "../ports/logger";
import type { IOrderLifecycleRepository } from "./ports";
import type { RefundService } from "./refund-service";

/** What one run of the background jobs did. */
export interface JobsRun {
  readonly notifications: number;
  readonly refundsStarted: number;
  readonly refundsFailed: number;
}

/**
 * Work the scheduler triggers every 30 seconds (docs/ARCHITECTURE.md §4g): send the messages the
 * database queued (SLA texts and alerts) and refund paid orders that ended early but still hold
 * the money (store timeouts cancelled by pg_cron, or a refund that failed at the time). Safe to run
 * twice at once: messages are claimed and refunds are reserved before anything is sent.
 */
export class BackgroundJobs {
  constructor(
    private readonly deps: {
      notifications: { deliverQueued(limit: number): Promise<number> };
      lifecycle: IOrderLifecycleRepository;
      refunds: RefundService;
      logger: Logger;
      batchSize?: number;
    },
  ) {}

  async run(): Promise<JobsRun> {
    const limit = this.deps.batchSize ?? 50;
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
    if (notifications + refundsStarted + refundsFailed > 0) {
      this.deps.logger.info("jobs.run", { notifications, refundsStarted, refundsFailed });
    }
    return { notifications, refundsStarted, refundsFailed };
  }
}
