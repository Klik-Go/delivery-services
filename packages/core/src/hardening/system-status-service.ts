import type { SessionUser } from "../auth/session-user";
import type { ConsoleAccess } from "../ops/console-access";
import type { Clock } from "../ports/clock";
import type { AppError } from "../shared/errors";
import { ok, type Result } from "../shared/result";
import type {
  CronJobView,
  ISystemStatusRepository,
  JobRunView,
  SlaBreachView,
  WebhookFailureView,
} from "./ports";

/** The scheduler calls the jobs every 10 seconds; two minutes without a good run is an incident. */
export const JOB_LAG_ALERT_SECONDS = 120;
/** A webhook still unprocessed after five minutes is stuck. */
const WEBHOOK_STALE_MS = 5 * 60_000;
const LOOKBACK_MS = 24 * 3_600_000;

/** What /admin/system shows. */
export interface SystemStatus {
  readonly checkedAt: Date;
  readonly jobs: {
    readonly lastRun: JobRunView | null;
    readonly lastSuccessAt: Date | null;
    /** Seconds since the last successful run, or null when none ran yet. */
    readonly lagSeconds: number | null;
    readonly healthy: boolean;
    readonly recent: readonly JobRunView[];
  };
  readonly cron: readonly CronJobView[];
  readonly webhookFailures: readonly WebhookFailureView[];
  readonly slaBreaches: readonly SlaBreachView[];
}

/** One page for admins: background job lag, failing webhooks and missed deadlines (last 24 h). */
export class SystemStatusService {
  constructor(
    private readonly deps: { access: ConsoleAccess; status: ISystemStatusRepository; clock: Clock },
  ) {}

  async status(user: SessionUser | null): Promise<Result<SystemStatus, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    const now = this.deps.clock.now();
    const since = new Date(now.getTime() - LOOKBACK_MS);
    const [recent, cron, webhookFailures, slaBreaches] = await Promise.all([
      this.deps.status.jobRuns(20),
      this.deps.status.cronJobs(),
      this.deps.status.webhookFailures(since, new Date(now.getTime() - WEBHOOK_STALE_MS), 50),
      this.deps.status.slaBreaches(since, 50),
    ]);
    const lastSuccess = recent.find((run) => run.ok === true) ?? null;
    const lastSuccessAt = lastSuccess?.finishedAt ?? null;
    const lagSeconds = lastSuccessAt
      ? Math.max(0, Math.round((now.getTime() - lastSuccessAt.getTime()) / 1000))
      : null;
    return ok({
      checkedAt: now,
      jobs: {
        lastRun: recent[0] ?? null,
        lastSuccessAt,
        lagSeconds,
        healthy: lagSeconds !== null && lagSeconds <= JOB_LAG_ALERT_SECONDS,
        recent,
      },
      cron,
      webhookFailures,
      slaBreaches,
    });
  }
}
