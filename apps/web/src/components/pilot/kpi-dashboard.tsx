"use client";

import { formatPeso, type KpiDashboard as Dashboard, type KpiPeriod } from "@klikgo/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import type { Wire } from "@/components/admin/wire";
import { fetchData } from "@/lib/post-json";

type Period = Wire<KpiPeriod>;

/** Today, 7 and 30 days side by side with the plan's targets, and a 14-day trend (admins). */
export function KpiDashboard(): JSX.Element {
  const t = useTranslations("Pilot.kpis");
  const kpis = useQuery({
    queryKey: ["kpis"],
    queryFn: () => fetchData<Wire<Dashboard>>("/api/admin/kpis", t("failed")),
    refetchInterval: 60_000,
  });
  if (kpis.isPending) return <p className="text-ink-muted">{t("loading")}</p>;
  if (kpis.isError) return <FormError message={kpis.error.message} />;
  const { periods, days, targets } = kpis.data;
  const none = t("none");
  const pct = (bps: number | null): string => (bps === null ? none : `${(bps / 100).toFixed(1)}%`);
  const peso = (centavos: number | null): string =>
    centavos === null ? none : formatPeso(centavos);
  const count = (n: number): string => String(n);

  const rows: {
    readonly key: string;
    readonly label: string;
    readonly value: (p: Period) => string;
    readonly target?: string;
    /** True when the value meets the target (for the colour). */
    readonly ok?: (p: Period) => boolean | null;
  }[] = [
    { key: "orders", label: t("orders"), value: (p) => count(p.figures.placed) },
    { key: "delivered", label: t("delivered"), value: (p) => count(p.figures.delivered) },
    { key: "gmv", label: t("gmv"), value: (p) => peso(p.figures.gmvCentavos) },
    {
      key: "aov",
      label: t("aov"),
      value: (p) => peso(p.aovCentavos),
      target: formatPeso(targets.aovCentavos),
      ok: (p) => (p.aovCentavos === null ? null : p.aovCentavos >= targets.aovCentavos),
    },
    {
      key: "takeRate",
      label: t("takeRate"),
      value: (p) => pct(p.takeRateBps),
      target: `≥ ${pct(targets.takeRateBps)}`,
      ok: (p) => (p.takeRateBps === null ? null : p.takeRateBps >= targets.takeRateBps),
    },
    {
      key: "contribution",
      label: t("contribution"),
      value: (p) => peso(p.contributionPerOrderCentavos),
      target: "> ₱0.00",
      ok: (p) =>
        p.contributionPerOrderCentavos === null ? null : p.contributionPerOrderCentavos > 0,
    },
    {
      key: "completion",
      label: t("completion"),
      value: (p) => pct(p.completionBps),
      target: `> ${pct(targets.completionBps)}`,
      ok: (p) => (p.completionBps === null ? null : p.completionBps >= targets.completionBps),
    },
    {
      key: "platformCancel",
      label: t("platformCancel"),
      value: (p) => pct(p.platformCancelBps),
      target: `< ${pct(targets.platformCancelBps)}`,
      ok: (p) =>
        p.platformCancelBps === null ? null : p.platformCancelBps < targets.platformCancelBps,
    },
    { key: "codShare", label: t("codShare"), value: (p) => pct(p.codShareBps) },
    { key: "customers", label: t("customers"), value: (p) => count(p.figures.customers) },
    {
      key: "repeat",
      label: t("repeat"),
      value: (p) => pct(p.repeatBps),
      target: pct(targets.retentionBps),
      ok: (p) => (p.repeatBps === null ? null : p.repeatBps >= targets.retentionBps),
    },
    { key: "merchants", label: t("merchants"), value: (p) => count(p.figures.activeMerchants) },
    { key: "riders", label: t("riders"), value: (p) => count(p.figures.activeRiders) },
    {
      key: "confirm",
      label: t("confirm"),
      value: (p) => (p.confirmSeconds === null ? none : t("seconds", { value: p.confirmSeconds })),
      target: `< ${t("seconds", { value: targets.confirmSeconds })}`,
      ok: (p) => (p.confirmSeconds === null ? null : p.confirmSeconds < targets.confirmSeconds),
    },
    {
      key: "delivery",
      label: t("delivery"),
      value: (p) =>
        p.deliveryMinutes === null ? none : t("minutes", { value: p.deliveryMinutes }),
      target: `< ${t("minutes", { value: targets.deliveryMinutes })}`,
      ok: (p) => (p.deliveryMinutes === null ? null : p.deliveryMinutes < targets.deliveryMinutes),
    },
    {
      key: "utilisation",
      label: t("utilisation"),
      value: (p) => pct(p.utilisationBps),
      target: `> ${pct(targets.utilisationBps)}`,
      ok: (p) => (p.utilisationBps === null ? null : p.utilisationBps > targets.utilisationBps),
    },
    {
      key: "earningsPerHour",
      label: t("earningsPerHour"),
      value: (p) => peso(p.riderEarningsPerHourCentavos),
    },
  ];

  const tone = (ok: boolean | null | undefined): string =>
    ok === true ? "text-ink" : ok === false ? "text-danger-900 font-semibold" : "text-ink";

  return (
    <div className="flex flex-col gap-6">
      <div
        className="-mx-4 overflow-x-auto px-4"
        role="region"
        aria-label={t("title")}
        tabIndex={0}
      >
        <table className="w-full min-w-[36rem] text-left text-sm" data-testid="kpi-table">
          <thead>
            <tr className="border-ink-muted/30 border-b">
              <th scope="col" className="text-ink py-2 pr-3">
                {t("metric")}
              </th>
              {periods.map((p) => (
                <th key={p.label} scope="col" className="text-ink py-2 pr-3 text-right">
                  {t(`period.${p.label}`)}
                </th>
              ))}
              <th scope="col" className="text-ink-muted py-2 text-right">
                {t("target")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} data-kpi={row.key} className="border-ink-muted/10 border-b">
                <th scope="row" className="text-ink py-2 pr-3 font-normal">
                  {row.label}
                </th>
                {periods.map((p) => (
                  <td
                    key={p.label}
                    className={`py-2 pr-3 text-right tabular-nums ${tone(row.ok?.(p))}`}
                  >
                    {row.value(p)}
                  </td>
                ))}
                <td className="text-ink-muted py-2 text-right">{row.target ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section aria-labelledby="trend" className="flex flex-col gap-2">
        <h2 id="trend" className="text-ink text-lg font-bold">
          {t("trend")}
        </h2>
        <div
          className="-mx-4 overflow-x-auto px-4"
          role="region"
          aria-label={t("trend")}
          tabIndex={0}
        >
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead>
              <tr className="border-ink-muted/30 border-b">
                <th scope="col" className="text-ink py-1 pr-3">
                  {t("day")}
                </th>
                <th scope="col" className="text-ink py-1 pr-3 text-right">
                  {t("orders")}
                </th>
                <th scope="col" className="text-ink py-1 pr-3 text-right">
                  {t("delivered")}
                </th>
                <th scope="col" className="text-ink py-1 pr-3 text-right">
                  {t("gmv")}
                </th>
                <th scope="col" className="text-ink py-1 text-right">
                  {t("confirm")}
                </th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day} className="border-ink-muted/10 border-b">
                  <th scope="row" className="text-ink py-1 pr-3 font-normal tabular-nums">
                    {d.day}
                  </th>
                  <td className="text-ink py-1 pr-3 text-right tabular-nums">{d.placed}</td>
                  <td className="text-ink py-1 pr-3 text-right tabular-nums">{d.delivered}</td>
                  <td className="text-ink py-1 pr-3 text-right tabular-nums">
                    {formatPeso(d.gmvCentavos)}
                  </td>
                  <td className="text-ink py-1 text-right tabular-nums">
                    {d.avgConfirmSeconds === null
                      ? none
                      : t("seconds", { value: d.avgConfirmSeconds })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-ink-muted text-sm">{t("external")}</p>
    </div>
  );
}
