import type { SessionUser } from "../auth/session-user";
import type { ConsoleAccess } from "../ops/console-access";
import type { Clock } from "../ports/clock";
import type { AppError } from "../shared/errors";
import { ok, type Result } from "../shared/result";
import type { IKpiRepository, KpiDay, KpiFigures } from "./ports";

/** Asia/Manila is UTC+8 all year (no daylight saving). */
const MANILA_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;

/** Targets from docs/BUSINESS.md §13 (Month 6 for business KPIs). */
export const KPI_TARGETS = {
  aovCentavos: 28_000,
  takeRateBps: 2_500,
  retentionBps: 4_000,
  completionBps: 9_500,
  platformCancelBps: 200,
  deliveryMinutes: 35,
  confirmSeconds: 180,
  utilisationBps: 6_000,
} as const;

/** One period of the dashboard, with the ratios worked out (basis points: 10 000 = 100%). */
export interface KpiPeriod {
  readonly label: "today" | "7d" | "30d";
  readonly from: Date;
  readonly to: Date;
  readonly figures: KpiFigures;
  readonly aovCentavos: number | null;
  readonly takeRateBps: number | null;
  readonly completionBps: number | null;
  readonly platformCancelBps: number | null;
  readonly codShareBps: number | null;
  readonly repeatBps: number | null;
  /** Platform revenue − promos − gateway fees − refunds, per delivered order. */
  readonly contributionPerOrderCentavos: number | null;
  readonly confirmSeconds: number | null;
  readonly deliveryMinutes: number | null;
  readonly utilisationBps: number | null;
  /** Rider earnings and tips per online hour. */
  readonly riderEarningsPerHourCentavos: number | null;
}

export interface KpiDashboard {
  readonly checkedAt: Date;
  readonly periods: readonly KpiPeriod[];
  readonly days: readonly KpiDay[];
  readonly targets: typeof KPI_TARGETS;
}

const ratio = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((part * 10_000) / whole) : null;
const per = (amount: number, count: number): number | null =>
  count > 0 ? Math.round(amount / count) : null;

/** Midnight in Manila of the day `at` falls on, as a UTC instant. */
export function manilaMidnight(at: Date): Date {
  const local = at.getTime() + MANILA_OFFSET_MS;
  return new Date(local - (local % DAY_MS) - MANILA_OFFSET_MS);
}

/** Derives the dashboard's ratios from raw figures (pure, for tests). */
export function derive(label: KpiPeriod["label"], from: Date, to: Date, f: KpiFigures): KpiPeriod {
  const contribution =
    f.platformRevenueCentavos - f.promoCostCentavos - f.gatewayFeesCentavos - f.refundsCentavos;
  return {
    label,
    from,
    to,
    figures: f,
    aovCentavos: per(f.gmvCentavos, f.delivered),
    takeRateBps: ratio(f.platformRevenueCentavos, f.gmvCentavos),
    completionBps: ratio(f.delivered, f.placed),
    platformCancelBps: ratio(f.cancelledByPlatform, f.placed),
    codShareBps: ratio(f.codDelivered, f.delivered),
    repeatBps: ratio(f.repeatCustomers, f.customers),
    contributionPerOrderCentavos: per(contribution, f.delivered),
    confirmSeconds: f.avgConfirmSeconds === null ? null : Math.round(f.avgConfirmSeconds),
    deliveryMinutes:
      f.avgDeliverySeconds === null ? null : Math.round((f.avgDeliverySeconds / 60) * 10) / 10,
    utilisationBps: ratio(f.riderBusySeconds, f.riderOnlineSeconds),
    riderEarningsPerHourCentavos:
      f.riderOnlineSeconds > 0
        ? Math.round((f.riderEarningsCentavos * 3_600) / f.riderOnlineSeconds)
        : null,
  };
}

/**
 * The pilot's daily KPI view for admins (docs/BUSINESS.md §13.1, §13.2, BUILD_PLAN Phase 12):
 * today, the last 7 and 30 days (Manila days), and a 14-day trend. NPS, crash-free sessions and
 * uptime come from the survey, Sentry and the uptime monitor, not from the database.
 */
export class KpiService {
  constructor(
    private readonly deps: { access: ConsoleAccess; kpis: IKpiRepository; clock: Clock },
  ) {}

  async dashboard(user: SessionUser | null): Promise<Result<KpiDashboard, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    const now = this.deps.clock.now();
    const today = manilaMidnight(now);
    const ranges: [KpiPeriod["label"], Date][] = [
      ["today", today],
      ["7d", new Date(today.getTime() - 6 * DAY_MS)],
      ["30d", new Date(today.getTime() - 29 * DAY_MS)],
    ];
    const [periods, days] = await Promise.all([
      Promise.all(
        ranges.map(async ([label, from]) =>
          derive(label, from, now, await this.deps.kpis.figures(from, now)),
        ),
      ),
      this.deps.kpis.daily(14, now),
    ]);
    return ok({ checkedAt: now, periods, days, targets: KPI_TARGETS });
  }
}
