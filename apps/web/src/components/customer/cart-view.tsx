"use client";

import { formatPeso, type CartQuote } from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { useQuery } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { useCart } from "@/lib/cart-store";
import { requestJson } from "@/lib/post-json";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * The cart. Every number on this screen comes from the server's quote (/api/cart/quote); the
 * device only remembers which dishes and choices were picked.
 */
export function CartView({
  dropoff,
}: {
  readonly dropoff: { lat: number; lng: number } | null;
}): JSX.Element {
  const t = useTranslations("Customer.cart");
  const hydrated = useHydrated();
  const { store, lines, setQuantity } = useCart();
  const request =
    store && dropoff && lines.length > 0
      ? {
          merchantId: store.merchantId,
          items: lines.map((l) => ({
            itemId: l.itemId,
            quantity: l.quantity,
            optionIds: [...l.optionIds],
          })),
          dropoff,
        }
      : null;
  const quote = useQuery({
    queryKey: ["quote", request],
    enabled: request !== null,
    queryFn: async () => {
      const result = await requestJson<CartQuote>("POST", "/api/cart/quote", request, t("pricing"));
      if (!result.ok) throw new Error(result.message);
      return result.data;
    },
  });

  if (!hydrated) return <p className="text-ink-muted">{t("pricing")}</p>;
  if (!store || lines.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-ink-muted">{t("empty")}</p>
        <Link href="/" className="text-brand-800 font-semibold underline">
          {t("browse")}
        </Link>
      </div>
    );
  }
  if (!dropoff) {
    return (
      <Link href="/address" className="text-brand-800 font-semibold underline">
        {t("needAddress")}
      </Link>
    );
  }

  const data = quote.data;
  const priced = new Map(
    data?.lines.map((l) => [`${l.itemId}:${[...l.optionIds].sort().join(":")}`, l]),
  );
  const issues = new Map(data?.issues.map((i) => [i.itemId, i.code]));
  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/s/${store.slug}`}
        className="text-ink text-xl font-bold underline-offset-2 hover:underline"
      >
        {store.name}
      </Link>
      <ul className="flex flex-col gap-2" aria-busy={quote.isFetching}>
        {lines.map((line) => {
          const server = priced.get(`${line.itemId}:${[...line.optionIds].sort().join(":")}`);
          const issue = issues.get(line.itemId);
          return (
            <li key={line.key} className="bg-surface-muted flex items-center gap-3 rounded-xl p-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-ink font-semibold">{line.name}</span>
                {line.optionNames.length > 0 ? (
                  <span className="text-ink-muted text-sm">{line.optionNames.join(", ")}</span>
                ) : null}
                {issue ? (
                  <span className="text-danger-900 text-sm font-semibold">
                    {t(`issue.${issue}`)}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  className="px-3"
                  aria-label={`${t("remove")}: ${line.name}`}
                  onClick={() => setQuantity(line.key, line.quantity - 1)}
                >
                  <Minus aria-hidden className="size-4" />
                </Button>
                <span className="w-6 text-center font-bold">{line.quantity}</span>
                <Button
                  variant="ghost"
                  className="px-3"
                  aria-label={`+1 ${line.name}`}
                  onClick={() => setQuantity(line.key, line.quantity + 1)}
                >
                  <Plus aria-hidden className="size-4" />
                </Button>
              </div>
              <span className="text-ink w-20 text-right font-semibold" data-testid="line-total">
                {server ? formatPeso(server.lineTotalCentavos) : "—"}
              </span>
            </li>
          );
        })}
      </ul>

      {quote.isError ? <FormError message={quote.error.message} /> : null}
      {data ? (
        <dl className="flex flex-col gap-1" data-testid="quote">
          <Row label={t("subtotal")} value={data.subtotalCentavos} />
          <Row label={t("delivery")} value={data.deliveryFeeCentavos} />
          {data.smallOrderFeeCentavos > 0 ? (
            <Row label={t("smallOrder")} value={data.smallOrderFeeCentavos} />
          ) : null}
          {data.serviceFeeCentavos > 0 ? (
            <Row label={t("service")} value={data.serviceFeeCentavos} />
          ) : null}
          <Row label={t("total")} value={data.totalCentavos} strong />
        </dl>
      ) : (
        <p className="text-ink-muted">{t("pricing")}</p>
      )}
      {data && !data.deliverable ? <FormError message={t("notDeliverable")} /> : null}
      <p className="text-ink-muted text-xs">{t("priceNote")}</p>
      <Button size="lg" disabled>
        {t("checkout")}
      </Button>
      <p className="text-ink-muted text-sm">{t("checkoutSoon")}</p>
    </div>
  );
}

function Row({
  label,
  value,
  strong = false,
}: {
  readonly label: string;
  readonly value: number;
  readonly strong?: boolean;
}): JSX.Element {
  return (
    <div className={`flex justify-between ${strong ? "text-ink text-lg font-bold" : "text-ink"}`}>
      <dt>{label}</dt>
      <dd>{formatPeso(value)}</dd>
    </div>
  );
}
