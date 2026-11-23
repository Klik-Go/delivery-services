import type { SessionUser } from "../auth/session-user";
import type { ConsoleAccess } from "../ops/console-access";
import { toCsv } from "../shared/csv";
import { ValidationError, type AppError } from "../shared/errors";
import type { Centavos } from "../shared/money";
import { err, ok, type Result } from "../shared/result";
import { formatManilaDateTime } from "../shared/time";
import { CHART_OF_ACCOUNTS } from "./chart-of-accounts";
import type { CsvFile } from "./payout-service";
import type { IReportRepository, ZoneWeekFigures } from "./ports";
import { weekStarting, type Week } from "./week";

/** One zone's week with the business numbers worked out (docs/BUSINESS.md §6, §8 KPIs). */
export interface ZoneWeekReport extends ZoneWeekFigures {
  /** (Commission + platform-kept fees) ÷ GMV, in basis points (1,250 = 12.5%). */
  readonly takeRateBps: number;
  /** Platform revenue less promo cost, gateway fees and refunds after delivery. */
  readonly contributionCentavos: Centavos;
  readonly contributionPerOrderCentavos: Centavos;
  /** Cash-on-delivery orders ÷ delivered orders, in basis points. */
  readonly codShareBps: number;
}

export interface WeekReport {
  readonly week: Pick<Week, "start" | "end">;
  readonly zones: readonly ZoneWeekReport[];
  readonly total: ZoneWeekReport;
}

const ratioBps = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part * 10_000) / whole) : 0;

function derive(f: ZoneWeekFigures): ZoneWeekReport {
  const contribution =
    f.platformRevenueCentavos - f.promoCostCentavos - f.gatewayFeesCentavos - f.refundsCentavos;
  return {
    ...f,
    takeRateBps: ratioBps(f.platformRevenueCentavos, f.gmvCentavos),
    contributionCentavos: contribution,
    contributionPerOrderCentavos:
      f.deliveredOrders > 0 ? Math.round(contribution / f.deliveredOrders) : 0,
    codShareBps: ratioBps(f.codOrders, f.deliveredOrders),
  };
}

const pct = (bps: number): string => `${(bps / 100).toFixed(2)}%`;

/**
 * Weekly reports for admins (docs/BUILD_PLAN.md Phase 10): GMV, take rate, contribution per order,
 * refunds, promo cost and cash-on-delivery share by zone, plus the week's ledger mapped to the
 * chart of accounts for the bookkeeper (docs/BUSINESS.md §6.5). Definitions are in
 * docs/ARCHITECTURE.md §4k.
 */
export class ReportService {
  constructor(private readonly deps: { reports: IReportRepository; access: ConsoleAccess }) {}

  async week(user: SessionUser | null, weekStart: string): Promise<Result<WeekReport, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    const week = weekStarting(weekStart);
    if (!week)
      return err(
        new ValidationError("Pick a Monday.", [{ path: "weekStart", message: "Not a Monday" }]),
      );
    const figures = await this.deps.reports.zoneWeeks(week);
    const sum = (pick: (f: ZoneWeekFigures) => number): number =>
      figures.reduce((total, f) => total + pick(f), 0);
    const total = derive({
      zoneId: "all",
      zoneName: "All zones",
      deliveredOrders: sum((f) => f.deliveredOrders),
      codOrders: sum((f) => f.codOrders),
      gmvCentavos: sum((f) => f.gmvCentavos),
      tipsCentavos: sum((f) => f.tipsCentavos),
      platformRevenueCentavos: sum((f) => f.platformRevenueCentavos),
      promoCostCentavos: sum((f) => f.promoCostCentavos),
      gatewayFeesCentavos: sum((f) => f.gatewayFeesCentavos),
      refundsCentavos: sum((f) => f.refundsCentavos),
    });
    return ok({ week: { start: week.start, end: week.end }, zones: figures.map(derive), total });
  }

  async weekCsv(user: SessionUser | null, weekStart: string): Promise<Result<CsvFile, AppError>> {
    const report = await this.week(user, weekStart);
    if (!report.ok) return report;
    const rows = [...report.value.zones, report.value.total].map((z) => [
      z.zoneName,
      z.deliveredOrders,
      { centavos: z.gmvCentavos },
      { centavos: z.platformRevenueCentavos },
      pct(z.takeRateBps),
      { centavos: z.promoCostCentavos },
      { centavos: z.gatewayFeesCentavos },
      { centavos: z.refundsCentavos },
      { centavos: z.contributionCentavos },
      { centavos: z.contributionPerOrderCentavos },
      pct(z.codShareBps),
      { centavos: z.tipsCentavos },
    ]);
    return ok({
      filename: `klikgo-report-${weekStart}.csv`,
      body: toCsv(
        [
          "Zone",
          "Delivered orders",
          "GMV (PHP)",
          "Platform revenue (PHP)",
          "Take rate",
          "Promo cost (PHP)",
          "Gateway fees (PHP)",
          "Refunds (PHP)",
          "Contribution (PHP)",
          "Contribution per order (PHP)",
          "COD share",
          "Rider tips (PHP)",
        ],
        rows,
      ),
    });
  }

  /** The week's ledger rows with the bookkeeper's account codes. */
  async ledgerCsv(user: SessionUser | null, weekStart: string): Promise<Result<CsvFile, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    const week = weekStarting(weekStart);
    if (!week)
      return err(
        new ValidationError("Pick a Monday.", [{ path: "weekStart", message: "Not a Monday" }]),
      );
    const rows = (await this.deps.reports.ledger(week)).map((r) => {
      const chart = CHART_OF_ACCOUNTS[r.account];
      return [
        formatManilaDateTime(r.createdAt),
        r.txnId,
        chart.code,
        chart.name,
        chart.group,
        r.account,
        r.partyType,
        r.orderCode ?? "",
        { centavos: r.debitCentavos },
        { centavos: r.creditCentavos },
        r.memo ?? "",
      ];
    });
    await this.deps.access.record(
      admin.value,
      "ledger.export",
      { type: "ledger_entries", id: null },
      {
        weekStart,
        rows: rows.length,
      },
    );
    return ok({
      filename: `klikgo-ledger-${weekStart}.csv`,
      body: toCsv(
        [
          "Date (Manila)",
          "Transaction",
          "Account code",
          "Account",
          "Group",
          "Ledger account",
          "Party",
          "Order",
          "Debit (PHP)",
          "Credit (PHP)",
          "Memo",
        ],
        rows,
      ),
    });
  }
}
