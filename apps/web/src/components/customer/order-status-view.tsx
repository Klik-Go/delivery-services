"use client";

import { formatPeso, type OrderView } from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { fetchData, postJson } from "@/lib/post-json";
import { useLiveTopic } from "@/lib/realtime";
import { TrackingMap } from "./tracking-map";

/** Statuses that still change without the customer doing anything (keep listening). */
const LIVE = new Set(["awaiting_payment", "placed", "accepted", "preparing", "ready", "picked_up"]);

/** Statuses with a live map: the store took the order and it is not delivered yet. */
const ON_MAP = new Set(["accepted", "preparing", "ready", "picked_up"]);

/** The tracking stepper: each step and the timeline field that says when it happened. */
const STEPS = [
  { key: "placed", at: "placedAt" },
  { key: "accepted", at: "acceptedAt" },
  { key: "preparing", at: "preparingAt" },
  { key: "ready", at: "readyAt" },
  { key: "picked_up", at: "pickedUpAt" },
  { key: "delivered", at: "deliveredAt" },
] as const;

/**
 * The order's status, payment and progress. Live over the order's private Realtime channel, with
 * slow polling as a safety net (fast polling when live updates are unavailable).
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
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["order", orderId] });
  }, [queryClient, orderId]);
  const live = useLiveTopic(`order:${orderId}`, refresh);
  const order = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => fetchData<OrderView>(`/api/orders/${orderId}`, t("failed")),
    refetchInterval: (query) =>
      query.state.data && !LIVE.has(query.state.data.status)
        ? false
        : live === "live"
          ? 30_000
          : 4000,
  });

  if (order.isPending) return <p className="text-ink-muted">{t("loading")}</p>;
  if (order.isError) return <FormError message={order.error.message} />;
  const o = order.data;
  const waiting = o.status === "awaiting_payment";
  const ended = o.status === "rejected" || o.status === "cancelled";
  const time = new Intl.DateTimeFormat(locale === "fil" ? "fil-PH" : "en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  });
  const reason =
    o.status === "rejected"
      ? o.rejectReason
      : o.cancelReason === "merchant_timeout"
        ? t("reason.merchant_timeout")
        : o.cancelReason === "payment_timeout"
          ? t("reason.payment_timeout")
          : o.cancelReason;

  const cancel = async (): Promise<void> => {
    setCancelling(true);
    setCancelError(null);
    const result = await postJson<unknown>(`/api/orders/${orderId}/cancel`, {}, t("failed"));
    setCancelling(false);
    if (!result.ok) setCancelError(result.message);
    refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <h1 className="text-ink text-2xl font-bold">{t("title", { code: o.code })}</h1>
        {live === "live" && LIVE.has(o.status) ? (
          <span className="bg-brand-50 text-brand-800 rounded-full px-2 py-1 text-xs font-semibold">
            {t("live")}
          </span>
        ) : null}
      </div>
      <p className="text-ink-muted">{o.merchantName}</p>
      <p className="text-ink text-xl font-semibold" role="status" data-testid="order-status">
        {t(`status.${o.status}`)}
      </p>
      {o.readyBy && (o.status === "preparing" || o.status === "accepted") ? (
        <p className="text-ink" data-testid="ready-by">
          {t("readyBy", { time: time.format(new Date(o.readyBy)), minutes: o.prepMinutes ?? 0 })}
        </p>
      ) : null}
      {ended && reason ? (
        <p className="text-ink" data-testid="end-reason">
          {reason}
        </p>
      ) : null}
      {o.deliveryPin ? (
        <p className="bg-accent-400 text-ink rounded-xl p-3" data-testid="delivery-pin">
          {t.rich("pin", {
            pin: o.deliveryPin,
            b: (chunks) => <strong className="text-xl tracking-widest">{chunks}</strong>,
          })}
        </p>
      ) : null}
      {ON_MAP.has(o.status) ? <TrackingMap orderId={orderId} /> : null}
      {waiting && returned === "paid" ? <p className="text-ink-muted">{t("confirming")}</p> : null}
      {waiting && returned === "cancelled" ? (
        <p className="text-ink-muted">{t("paymentCancelled")}</p>
      ) : null}

      {!ended && !waiting ? (
        <ol className="flex flex-col" aria-label={t("progress")} data-testid="order-stepper">
          {STEPS.map((step) => {
            const at = o.timeline[step.at];
            return (
              <li
                key={step.key}
                className="flex items-center gap-3 py-2"
                aria-current={o.status === step.key ? "step" : undefined}
              >
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-full ${at ? "bg-brand-800 text-white" : "bg-surface-muted text-ink-muted"}`}
                  aria-hidden
                >
                  {at ? <Check className="size-4" /> : null}
                </span>
                <span className={`flex-1 ${at ? "text-ink font-semibold" : "text-ink-muted"}`}>
                  {t(`step.${step.key}`)}
                </span>
                <span className="text-ink-muted text-sm">
                  {at ? time.format(new Date(at)) : ""}
                </span>
              </li>
            );
          })}
        </ol>
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
      {o.canCancel ? (
        <Button variant="secondary" disabled={cancelling} onClick={() => void cancel()}>
          {t("cancel")}
        </Button>
      ) : null}
      {cancelError ? <FormError message={cancelError} /> : null}
      <Link href="/" className="text-brand-800 font-semibold underline">
        {t("home")}
      </Link>
    </div>
  );
}
