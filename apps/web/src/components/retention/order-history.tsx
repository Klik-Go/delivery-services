"use client";

import { formatPeso, type HistoryOrder } from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import type { Wire } from "@/components/admin/wire";
import { fetchData } from "@/lib/post-json";
import { ReorderButton } from "./reorder-button";

const PAGE = 20;

/** The customer's orders, newest first, with "Rate" and "Order again" (docs/BUSINESS.md §9.2.1). */
export function OrderHistory(): JSX.Element {
  const t = useTranslations("Retention.history");
  const tStatus = useTranslations("Customer.order.status");
  const locale = useLocale();
  const orders = useInfiniteQuery({
    queryKey: ["order-history"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchData<Wire<HistoryOrder>[]>(
        pageParam ? `/api/orders?before=${encodeURIComponent(pageParam)}` : "/api/orders",
        t("failed"),
      ),
    getNextPageParam: (last) => (last.length < PAGE ? null : (last.at(-1)?.createdAt ?? null)),
  });
  const date = new Intl.DateTimeFormat(locale === "fil" ? "fil-PH" : "en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  if (orders.isPending) return <p className="text-ink-muted">{t("loading")}</p>;
  if (orders.isError) return <FormError message={orders.error.message} />;
  const list = orders.data.pages.flat();
  if (list.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-ink-muted">{t("empty")}</p>
        <Link href="/" className="text-brand-800 font-semibold underline">
          {t("browse")}
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3" data-testid="order-history">
        {list.map((order) => {
          const toRate =
            order.status === "delivered" &&
            (!order.rated.includes("merchant") ||
              (order.hasRider && !order.rated.includes("rider")));
          return (
            <li
              key={order.id}
              className="border-border flex flex-col gap-2 rounded-xl border p-4"
              data-order={order.code}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-ink font-bold">{order.merchantName}</p>
                  <p className="text-ink-muted text-sm">
                    {date.format(new Date(order.createdAt))} · {order.code}
                  </p>
                </div>
                <p className="text-ink font-semibold">{formatPeso(order.totalCentavos)}</p>
              </div>
              <p className="text-ink text-sm">{order.itemsSummary}</p>
              <p className="text-ink-muted text-sm">{tStatus(order.status)}</p>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={`/orders/${order.id}`}
                  className="text-brand-800 min-h-tap inline-flex items-center font-semibold underline"
                >
                  {toRate ? t("rate") : t("details")}
                </Link>
                {order.status === "delivered" ||
                order.status === "cancelled" ||
                order.status === "rejected" ? (
                  <ReorderButton
                    orderId={order.id}
                    merchantName={order.merchantName}
                    variant="secondary"
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {orders.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={orders.isFetchingNextPage}
          onClick={() => void orders.fetchNextPage()}
        >
          {t("more")}
        </Button>
      ) : null}
    </div>
  );
}
