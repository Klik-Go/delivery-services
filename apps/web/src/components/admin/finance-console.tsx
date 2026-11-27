"use client";

import {
  formatPeso,
  previousWeek,
  weekOf,
  weekStarting,
  type CashHolder,
  type PayoutRecord,
  type WeekReport,
} from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { fetchData, postJson } from "@/lib/post-json";
import type { Wire } from "./wire";

type Tab = "payouts" | "cash" | "reports";

/** The last 12 settlement weeks (Mondays, Asia/Manila), newest first. */
function recentWeeks(): { start: string; end: string }[] {
  const weeks: { start: string; end: string }[] = [];
  let at = new Date();
  for (let i = 0; i < 12; i += 1) {
    const week = i === 0 ? weekOf(at) : previousWeek(at);
    weeks.push({ start: week.start, end: week.end });
    at = week.startsAt;
  }
  return weeks;
}

/**
 * Finance (docs/BUILD_PLAN.md Phase 10): admins settle weeks, export the transfer list and mark
 * payouts paid or failed, and read the weekly report; coordinators record cash riders hand in.
 */
export function FinanceConsole({
  isAdmin,
  initialWeek = null,
}: {
  readonly isAdmin: boolean;
  /** A week to open (from ?week=YYYY-MM-DD), e.g. an older one not in the recent list. */
  readonly initialWeek?: string | null;
}): JSX.Element {
  const t = useTranslations("Finance");
  const weeks = useMemo(() => {
    const recent = recentWeeks();
    const extra = initialWeek ? weekStarting(initialWeek) : null;
    return extra && !recent.some((w) => w.start === extra.start)
      ? [...recent, { start: extra.start, end: extra.end }]
      : recent;
  }, [initialWeek]);
  const [tab, setTab] = useState<Tab>(isAdmin ? "payouts" : "cash");
  // Last finished week by default: the one being paid out.
  const [week, setWeek] = useState(initialWeek ?? weeks[1]?.start ?? weeks[0]?.start ?? "");
  const tabs: Tab[] = isAdmin ? ["payouts", "cash", "reports"] : ["cash"];
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label={t("title")} className="flex flex-wrap gap-2">
        {tabs.map((key) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`min-h-tap rounded-full px-4 text-sm font-semibold ${tab === key ? "bg-brand-800 text-white" : "bg-surface-muted text-ink"}`}
          >
            {t(`tabs.${key}`)}
          </button>
        ))}
      </div>
      {tab !== "cash" ? (
        <label className="text-ink flex max-w-xs flex-col gap-1 text-sm font-semibold">
          {t("week")}
          <select
            value={week}
            onChange={(e) => setWeek(e.target.value)}
            className="border-border min-h-tap rounded-lg border px-3 font-normal"
          >
            {weeks.map((w) => (
              <option key={w.start} value={w.start}>
                {w.start} – {w.end}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {tab === "payouts" ? <PayoutsTab week={week} /> : null}
      {tab === "cash" ? <CashTab /> : null}
      {tab === "reports" ? <ReportsTab week={week} /> : null}
    </div>
  );
}

/** A finance API URL for one week; anything but a YYYY-MM-DD date is dropped, never put in a link. */
function weekUrl(path: string, week: string): string {
  const safe = /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : "";
  return `/api/admin/finance/${path}?${new URLSearchParams({ week: safe }).toString()}`;
}

function PayoutsTab({ week }: { readonly week: string }): JSX.Element {
  const t = useTranslations("Finance.payouts");
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ["finance-payouts", week],
    queryFn: () =>
      fetchData<{ payouts: Wire<PayoutRecord>[]; automatic: boolean }>(
        weekUrl("payouts", week),
        t("failed"),
      ),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = (): void =>
    void queryClient.invalidateQueries({ queryKey: ["finance-payouts", week] });

  const settle = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await postJson<unknown>("/api/admin/finance/settle", { week }, t("failed"));
    setBusy(false);
    if (!result.ok) setError(result.message);
    refresh();
  };

  if (list.isPending) return <p className="text-ink-muted">{t("loading")}</p>;
  if (list.isError) return <FormError message={list.error.message} />;
  const payouts = list.data.payouts;
  const due = payouts.filter((p) => p.status === "draft");
  const total = due.reduce((sum, p) => sum + p.amountCentavos, 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {payouts.length === 0 ? (
          <Button disabled={busy} onClick={() => void settle()}>
            {t("settle")}
          </Button>
        ) : (
          <p className="text-ink font-semibold">
            {t("due", { count: due.length, total: formatPeso(total) })}
          </p>
        )}
        {due.length > 0 ? (
          <a
            href={weekUrl("payouts/export", week)}
            className="text-action min-h-tap inline-flex items-center font-semibold"
          >
            {t("export")}
          </a>
        ) : null}
      </div>
      <p className="text-ink-muted text-sm">{list.data.automatic ? t("automatic") : t("manual")}</p>
      {error ? <FormError message={error} /> : null}
      {payouts.length === 0 ? <p className="text-ink-muted">{t("empty")}</p> : null}
      <ul className="flex flex-col gap-3" data-testid="finance-payouts">
        {payouts.map((p) => (
          <PayoutRow key={p.id} payout={p} onChanged={refresh} />
        ))}
      </ul>
    </div>
  );
}

function PayoutRow({
  payout,
  onChanged,
}: {
  readonly payout: Wire<PayoutRecord>;
  readonly onChanged: () => void;
}): JSX.Element {
  const t = useTranslations("Finance.payouts");
  const tStatus = useTranslations("Finance.statements.status");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (path: "paid" | "failed", body: unknown): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await postJson<unknown>(
      `/api/admin/finance/payouts/${payout.id}/${path}`,
      body,
      t("failed"),
    );
    setBusy(false);
    if (!result.ok) setError(result.message);
    else onChanged();
  };
  const a = payout.account;
  return (
    <li
      className="border-border flex flex-col gap-2 rounded-xl border p-4"
      data-payout={payout.partyName}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-ink font-bold">
            {payout.partyName} · {payout.partyType === "merchant" ? t("store") : t("rider")}
          </p>
          <p className="text-ink-muted text-sm">
            {a
              ? `${a.method.toUpperCase()} · ${a.accountName} · ${a.accountNumber}${a.bankName ? ` · ${a.bankName}` : ""}`
              : t("noAccount")}
          </p>
          {payout.cashNettedCentavos > 0 ? (
            <p className="text-ink-muted text-sm">
              {t("netted", {
                earned: formatPeso(payout.earningsCentavos),
                cash: formatPeso(payout.cashNettedCentavos),
              })}
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-ink text-lg font-bold">{formatPeso(payout.amountCentavos)}</p>
          <p className="text-ink-muted text-sm">
            {tStatus(payout.status)}
            {payout.reference && payout.reference !== "NETTED" ? ` · ${payout.reference}` : ""}
            {payout.failureReason ? ` · ${payout.failureReason}` : ""}
          </p>
        </div>
      </div>
      {payout.status === "draft" ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="text-ink flex flex-1 flex-col gap-1 text-sm font-semibold">
            {t("reference")}
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={100}
              className="border-border min-h-tap rounded-lg border px-3 font-normal"
            />
          </label>
          <Button
            disabled={busy || reference.trim().length < 2}
            onClick={() => void act("paid", { reference })}
          >
            {t("markPaid")}
          </Button>
          <label className="text-ink flex flex-1 flex-col gap-1 text-sm font-semibold">
            {t("reason")}
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              className="border-border min-h-tap rounded-lg border px-3 font-normal"
            />
          </label>
          <Button
            variant="secondary"
            disabled={busy || reason.trim().length < 3}
            onClick={() => void act("failed", { reason })}
          >
            {t("markFailed")}
          </Button>
        </div>
      ) : null}
      {error ? <FormError message={error} /> : null}
    </li>
  );
}

function CashTab(): JSX.Element {
  const t = useTranslations("Finance.cash");
  const list = useQuery({
    queryKey: ["finance-cash"],
    queryFn: () => fetchData<Wire<CashHolder>[]>("/api/admin/finance/cash", t("failed")),
  });
  if (list.isPending) return <p className="text-ink-muted">{t("loading")}</p>;
  if (list.isError) return <FormError message={list.error.message} />;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink-muted text-sm">{t("lead")}</p>
      {list.data.length === 0 ? <p className="text-ink-muted">{t("empty")}</p> : null}
      <ul className="flex flex-col gap-3" data-testid="cash-holders">
        {list.data.map((h) => (
          <CashRow key={h.riderId} holder={h} />
        ))}
      </ul>
    </div>
  );
}

function CashRow({ holder }: { readonly holder: Wire<CashHolder> }): JSX.Element {
  const t = useTranslations("Finance.cash");
  const queryClient = useQueryClient();
  const [pesos, setPesos] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountCentavos = Math.round(Number(pesos) * 100);
  const record = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await postJson<unknown>(
      "/api/admin/finance/cash",
      { riderId: holder.riderId, amountCentavos, reference },
      t("failed"),
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setPesos("");
    setReference("");
    void queryClient.invalidateQueries({ queryKey: ["finance-cash"] });
  };
  return (
    <li
      className="border-border flex flex-col gap-2 rounded-xl border p-4"
      data-holder={holder.name}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-ink font-bold">{holder.name}</p>
        <p className="text-ink font-semibold">
          {t("holds", {
            amount: formatPeso(holder.cashHeldCentavos),
            limit: formatPeso(holder.cashLimitCentavos),
          })}
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
          {t("amount")}
          <input
            value={pesos}
            onChange={(e) => setPesos(e.target.value)}
            inputMode="decimal"
            className="border-border min-h-tap rounded-lg border px-3 font-normal"
          />
        </label>
        <label className="text-ink flex flex-1 flex-col gap-1 text-sm font-semibold">
          {t("reference")}
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={100}
            className="border-border min-h-tap rounded-lg border px-3 font-normal"
          />
        </label>
        <Button
          disabled={busy || !(amountCentavos > 0) || reference.trim().length < 2}
          onClick={() => void record()}
        >
          {t("record")}
        </Button>
      </div>
      {error ? <FormError message={error} /> : null}
    </li>
  );
}

function ReportsTab({ week }: { readonly week: string }): JSX.Element {
  const t = useTranslations("Finance.reports");
  const report = useQuery({
    queryKey: ["finance-report", week],
    queryFn: () => fetchData<WeekReport>(weekUrl("report", week), t("failed")),
  });
  if (report.isPending) return <p className="text-ink-muted">{t("loading")}</p>;
  if (report.isError) return <FormError message={report.error.message} />;
  const pct = (bps: number): string => `${(bps / 100).toFixed(1)}%`;
  const rows = [...report.data.zones, report.data.total];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-4">
        <a
          href={weekUrl("report/export", week)}
          className="text-action min-h-tap inline-flex items-center font-semibold"
        >
          {t("exportReport")}
        </a>
        <a
          href={weekUrl("ledger/export", week)}
          className="text-action min-h-tap inline-flex items-center font-semibold"
        >
          {t("exportLedger")}
        </a>
      </div>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="text-ink w-full min-w-[640px] text-sm" data-testid="finance-report">
          <thead>
            <tr className="text-left">
              {[
                "zone",
                "orders",
                "gmv",
                "takeRate",
                "promo",
                "refunds",
                "contribution",
                "perOrder",
                "cod",
              ].map((key) => (
                <th
                  key={key}
                  scope="col"
                  className="border-border border-b py-2 pr-3 font-semibold"
                >
                  {t(`col.${key}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((z) => (
              <tr key={z.zoneId} className={z.zoneId === "all" ? "font-bold" : ""}>
                <th
                  scope="row"
                  className="border-border border-b py-2 pr-3 text-left font-semibold"
                >
                  {z.zoneName}
                </th>
                <td className="border-border border-b py-2 pr-3">{z.deliveredOrders}</td>
                <td className="border-border border-b py-2 pr-3">{formatPeso(z.gmvCentavos)}</td>
                <td className="border-border border-b py-2 pr-3">{pct(z.takeRateBps)}</td>
                <td className="border-border border-b py-2 pr-3">
                  {formatPeso(z.promoCostCentavos)}
                </td>
                <td className="border-border border-b py-2 pr-3">
                  {formatPeso(z.refundsCentavos)}
                </td>
                <td className="border-border border-b py-2 pr-3">
                  {formatPeso(z.contributionCentavos)}
                </td>
                <td className="border-border border-b py-2 pr-3">
                  {formatPeso(z.contributionPerOrderCentavos)}
                </td>
                <td className="border-border border-b py-2 pr-3">{pct(z.codShareBps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-ink-muted text-sm">{t("definitions")}</p>
    </div>
  );
}
