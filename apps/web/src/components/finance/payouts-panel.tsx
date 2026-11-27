"use client";

import { formatPeso, type PayoutStatement, type PayoutsPage } from "@klikgo/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import type { Wire } from "@/components/admin/wire";
import { fetchData } from "@/lib/post-json";
import { PayoutAccountForm } from "./payout-account-form";

/**
 * A store's or rider's money (docs/BUSINESS.md §5.3–5.4): where they are paid, what is earned and
 * not yet settled, and weekly statements with their lines and a CSV download.
 */
export function PayoutsPanel({
  base,
  kind,
}: {
  readonly base: string;
  readonly kind: "merchant" | "rider";
}): JSX.Element {
  const t = useTranslations("Finance.statements");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const page = useQuery({
    queryKey: ["payouts", base],
    queryFn: () => fetchData<Wire<PayoutsPage>>(base, t("failed")),
  });
  if (page.isPending) return <p className="text-ink-muted">{t("loading")}</p>;
  if (page.isError) return <FormError message={page.error.message} />;
  const p = page.data;
  const date = (iso: string): string =>
    new Intl.DateTimeFormat(locale === "fil" ? "fil-PH" : "en-PH", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${iso}T00:00:00Z`));

  return (
    <div className="flex flex-col gap-5">
      <section className="border-border flex flex-col gap-3 rounded-xl border p-4">
        <h2 className="text-ink text-lg font-bold">{t("accountTitle")}</h2>
        <PayoutAccountForm
          endpoint={`${base}/account`}
          account={p.account}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ["payouts", base] })}
        />
      </section>

      <section
        className="bg-sheet-alt flex flex-col gap-1 rounded-xl p-4"
        data-testid="open-balance"
      >
        <p className="text-ink">{t("open", { amount: formatPeso(p.openCentavos) })}</p>
        {kind === "rider" && p.cashHeldCentavos > 0 ? (
          <p className="text-ink">{t("cashHeld", { amount: formatPeso(p.cashHeldCentavos) })}</p>
        ) : null}
        <p className="text-ink-muted text-sm">
          {t("schedule", { minimum: formatPeso(p.minimumCentavos) })}
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-ink text-lg font-bold">{t("title")}</h2>
        {p.payouts.length === 0 ? <p className="text-ink-muted">{t("empty")}</p> : null}
        <ul className="flex flex-col gap-3" data-testid="statements">
          {p.payouts.map((payout) => (
            <Statement
              key={payout.id}
              base={base}
              payoutId={payout.id}
              heading={t("week", { from: date(payout.periodStart), to: date(payout.periodEnd) })}
              amount={payout.amountCentavos}
              status={payout.status}
              reference={payout.reference}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function Statement(props: {
  readonly base: string;
  readonly payoutId: string;
  readonly heading: string;
  readonly amount: number;
  readonly status: string;
  readonly reference: string | null;
}): JSX.Element {
  const t = useTranslations("Finance.statements");
  const [open, setOpen] = useState(false);
  const detail = useQuery({
    queryKey: ["statement", props.payoutId],
    queryFn: () => fetchData<Wire<PayoutStatement>>(`${props.base}/${props.payoutId}`, t("failed")),
    enabled: open,
  });
  return (
    <li
      className="border-border flex flex-col gap-2 rounded-xl border p-4"
      data-statement={props.heading}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-ink font-bold">{props.heading}</p>
          <p className="text-ink-muted text-sm">
            {props.reference === "NETTED" ? t("netted") : t(`status.${props.status}`)}
            {props.reference && props.reference !== "NETTED" ? ` · ${props.reference}` : ""}
          </p>
        </div>
        <p className="text-ink text-lg font-bold">{formatPeso(props.amount)}</p>
      </div>
      <div className="flex flex-wrap gap-4">
        <button
          type="button"
          className="text-action min-h-tap font-semibold underline"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? t("hide") : t("details")}
        </button>
        <a
          href={`${props.base}/${props.payoutId}/export`}
          className="text-action min-h-tap inline-flex items-center font-semibold"
        >
          {t("csv")}
        </a>
      </div>
      {open && detail.data ? (
        <ul className="text-ink flex flex-col gap-1 text-sm">
          {detail.data.lines.map((l, i) => (
            <li key={`${l.description}-${String(i)}`} className="flex justify-between gap-3">
              <span>{l.description}</span>
              <span className="font-semibold">{formatPeso(l.amountCentavos)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
