"use client";

import { formatPeso, type OrderView } from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { fetchData } from "@/lib/post-json";

/** Statuses that still change without the customer doing anything (keep refreshing). */
const LIVE = new Set(["awaiting_payment", "placed", "accepted", "preparing", "ready", "picked_up"]);

/**
 * The order's status and payment. Refreshes every few seconds while the order is moving (live
 * tracking over Realtime arrives with Phase 6); offers the payment page again while unpaid.
 */
export function OrderStatusView({
  orderId,
  returned,
}: {
  readonly orderId: string;
  readonly returned: "paid" | "cancelled" | null;
}): JSX.Element {
  const t = useTranslations("Customer.order");
  const tMethod = useTranslations("Customer.checkout.method");
  const order = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => fetchData<OrderView>(`/api/orders/${orderId}`, t("failed")),
    refetchInterval: (query) =>
      query.state.data && !LIVE.has(query.state.data.status) ? false : 4000,
  });

  if (order.isPending) return <p className="text-ink-muted">{t("loading")}</p>;
  if (order.isError) return <FormError message={order.error.message} />;
  const o = order.data;
  const waiting = o.status === "awaiting_payment";
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-ink text-2xl font-bold">{t("title", { code: o.code })}</h1>
      <p className="text-ink text-xl font-semibold" role="status" data-testid="order-status">
        {t(`status.${o.status}`)}
      </p>
      {waiting && returned === "paid" ? <p className="text-ink-muted">{t("confirming")}</p> : null}
      {waiting && returned === "cancelled" ? (
        <p className="text-ink-muted">{t("paymentCancelled")}</p>
      ) : null}
      <dl className="bg-surface-muted flex flex-col gap-2 rounded-xl p-4">
        <div className="flex justify-between">
          <dt className="text-ink">{t("total")}</dt>
          <dd className="text-ink font-bold">{formatPeso(o.totalCentavos)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink">{t("payment")}</dt>
          <dd className="text-ink">
            {tMethod(o.paymentMethod)} · {t(`paymentStatus.${o.paymentStatus}`)}
          </dd>
        </div>
        {o.refundedCentavos > 0 ? (
          <p className="text-ink text-sm">
            {t("refunded", { amount: formatPeso(o.refundedCentavos) })}
          </p>
        ) : null}
      </dl>
      {waiting && o.checkoutUrl ? (
        <Button size="lg" asChild>
          <a href={o.checkoutUrl}>{t("payNow", { total: formatPeso(o.totalCentavos) })}</a>
        </Button>
      ) : null}
      <Link href="/" className="text-brand-800 font-semibold underline">
        {t("home")}
      </Link>
    </div>
  );
}
