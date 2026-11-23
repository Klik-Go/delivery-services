import type { DispatchTick } from "../dispatch/dispatch-service";
import type { IJobRunRepository } from "../hardening/ports";
import type { Clock } from "../ports/clock";
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
  /** Delivered orders whose stamps and referral rewards were worked out. */
  readonly rewards: number;
  /** Payouts created by the weekly settlement (the first run after a week ends). */
  readonly settled: number;
  /** Rider ID files deleted under the retention rule. */
  readonly kycPurged: number;
}

/** Job runs are kept three days: enough to see a pattern, small enough at one run every 10 s. */
const KEEP_RUNS_MS = 3 * 86_400_000;

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
      rewards?: { processDelivered(limit: number): Promise<{ readonly processed: number }> };
      settlement?: { settleDueWeek(): Promise<{ readonly payouts: number } | null> };
      kycRetention?: { purgeDue(): Promise<{ readonly purged: number }> };
      /** Records each run for /admin/system (job lag). */
      runs?: { readonly repository: IJobRunRepository; readonly clock: Clock };
      logger: Logger;
      batchSize?: number;
    },
  ) {}

  /** One run, recorded in job_runs when a repository is wired (a failure is recorded too). */
  async run(): Promise<JobsRun> {
    const runs = this.deps.runs;
    if (!runs) return this.work();
    const started = runs.clock.now();
    const id = await runs.repository.start("background", started);
    try {
      const result = await this.work();
      await runs.repository.finish(id, { ok: true, summary: summarise(result) }, runs.clock.now());
      return result;
    } catch (error) {
      await runs.repository.finish(
        id,
        { ok: false, summary: {}, error: error instanceof Error ? error.name : "unknown" },
        runs.clock.now(),
      );
      throw error;
    } finally {
      await runs.repository.prune(new Date(started.getTime() - KEEP_RUNS_MS));
    }
  }

  private async work(): Promise<JobsRun> {
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
    const rewards = await this.rewardsRun(limit);
    const settled = await this.settlementRun();
    const kycPurged = await this.kycRun();
    if (
      notifications +
        refundsStarted +
        refundsFailed +
        dispatch.offered +
        dispatch.expired +
        rewards +
        kycPurged >
      0
    ) {
      this.deps.logger.info("jobs.run", {
        notifications,
        refundsStarted,
        refundsFailed,
        offersExpired: dispatch.expired,
        offersMade: dispatch.offered,
        rewards,
        settled,
        kycPurged,
      });
    }
    return { notifications, refundsStarted, refundsFailed, dispatch, rewards, settled, kycPurged };
  }

  /** ID files can wait for the next run, so a failure is logged and the rest carries on. */
  private async kycRun(): Promise<number> {
    if (!this.deps.kycRetention) return 0;
    try {
      return (await this.deps.kycRetention.purgeDue()).purged;
    } catch (error) {
      this.deps.logger.error("jobs.kyc_retention_failed", {
        err: error instanceof Error ? error.name : "unknown",
      });
      return 0;
    }
  }

  /** Settles last week once it is over; a failure is logged and retried on the next run. */
  private async settlementRun(): Promise<number> {
    if (!this.deps.settlement) return 0;
    try {
      return (await this.deps.settlement.settleDueWeek())?.payouts ?? 0;
    } catch (error) {
      this.deps.logger.error("jobs.settlement_failed", {
        err: error instanceof Error ? error.name : "unknown",
      });
      return 0;
    }
  }

  /** Rewards can wait for the next run, so a failure is logged and the rest carries on. */
  private async rewardsRun(limit: number): Promise<number> {
    if (!this.deps.rewards) return 0;
    try {
      return (await this.deps.rewards.processDelivered(limit)).processed;
    } catch (error) {
      this.deps.logger.error("jobs.rewards_failed", {
        err: error instanceof Error ? error.name : "unknown",
      });
      return 0;
    }
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

/** The counts a run records in job_runs.summary. */
function summarise(run: JobsRun): Record<string, number> {
  return {
    notifications: run.notifications,
    refundsStarted: run.refundsStarted,
    refundsFailed: run.refundsFailed,
    offersExpired: run.dispatch.expired,
    offersMade: run.dispatch.offered,
    dispatchFlagged: run.dispatch.flagged,
    rewards: run.rewards,
    settled: run.settled,
    kycPurged: run.kycPurged,
  };
}
