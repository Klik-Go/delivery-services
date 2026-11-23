"use client";

import { formatPeso, type PabiliView } from "@klikgo/core";
import { useQuery } from "@tanstack/react-query";
import { Check, Receipt, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { fetchData } from "@/lib/post-json";

/**
 * The Pabili part of an order page: where the rider buys, the list (ticked once bought), the
 * budget, and after the purchase the receipt total, what to pay at the door and a short-lived
 * link to the receipt photo. Refreshes with the order's status.
 */
export function PabiliOrderPanel({
  orderId,
  status,
}: {
  readonly orderId: string;
  /** The order's status; a change refetches (the receipt arrives with "ready"). */
  readonly status: string;
}): JSX.Element {
  const t = useTranslations("Pabili.order");
  const view = useQuery({
    queryKey: ["pabili", orderId, status],
    queryFn: () => fetchData<PabiliView>(`/api/pabili/orders/${orderId}`, t("failed")),
  });
  if (view.isPending) return <p className="text-ink-muted">{t("loading")}</p>;
  if (view.isError) return <FormError message={view.error.message} />;
  const p = view.data;
  return (
    <section
      aria-labelledby="pabili-panel-title"
      className="bg-surface-muted flex flex-col gap-3 rounded-xl p-4"
      data-testid="pabili-panel"
    >
      <h2 id="pabili-panel-title" className="text-ink text-lg font-bold">
        {t("title", { store: p.storeName })}
      </h2>
      {p.storeNotes ? <p className="text-ink-muted text-sm">{p.storeNotes}</p> : null}
      <ul className="flex flex-col gap-1">
        {p.lines.map((line) => (
          <li key={line.position} className="text-ink flex items-start gap-2">
            {line.status === "bought" ? (
              <Check aria-hidden className="text-brand-800 mt-0.5 size-5 shrink-0" />
            ) : line.status === "unavailable" ? (
              <X aria-hidden className="text-danger-900 mt-0.5 size-5 shrink-0" />
            ) : (
              <span aria-hidden className="size-5 shrink-0" />
            )}
            <span className="flex-1">
              {line.quantity} × {line.description}
              {line.note ? <span className="text-ink-muted"> · {line.note}</span> : null}
              {line.status !== "pending" ? (
                <span className="sr-only"> ({t(line.status)})</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <dl className="flex flex-col gap-1 border-t pt-2">
        <div className="flex justify-between">
          <dt className="text-ink">{t("budget")}</dt>
          <dd className="text-ink">{formatPeso(p.budgetCentavos)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink">{t("fees")}</dt>
          <dd className="text-ink">{formatPeso(p.feesCentavos)}</dd>
        </div>
        {p.itemCostCentavos !== null ? (
          <div className="flex justify-between">
            <dt className="text-ink">{t("itemCost")}</dt>
            <dd className="text-ink" data-testid="pabili-item-cost">
              {formatPeso(p.itemCostCentavos)}
            </dd>
          </div>
        ) : null}
        {p.toPayCentavos !== null ? (
          <div className="flex justify-between">
            <dt className="text-ink font-bold">{t("toPay")}</dt>
            <dd className="text-ink font-bold" data-testid="pabili-to-pay">
              {formatPeso(p.toPayCentavos)}
            </dd>
          </div>
        ) : (
          <p className="text-ink-muted text-sm">{t("payLater")}</p>
        )}
      </dl>
      {p.receiptUrl ? (
        <a
          href={p.receiptUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-800 min-h-tap inline-flex items-center gap-2 font-semibold underline"
          data-testid="pabili-receipt"
        >
          <Receipt aria-hidden className="size-5" /> {t("receipt")}
        </a>
      ) : null}
    </section>
  );
}
