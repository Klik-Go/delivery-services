"use client";

import { formatPeso, type CartQuote } from "@klikgo/core";
import { Button, EmptyState, Price, Sheet, SheetSection, TotalRow } from "@klikgo/ui";
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

  if (!hydrated) return <p className="text-ink-muted text-body">{t("pricing")}</p>;
  if (!store || lines.length === 0) {
    return (
      <EmptyState
        title={t("empty")}
        action={
          <Button asChild>
            <Link href="/">{t("browse")}</Link>
          </Button>
        }
      />
    );
  }
  if (!dropoff) {
    return (
      <EmptyState
        title={t("needAddress")}
        action={
          <Button asChild>
            <Link href="/address">{t("needAddress")}</Link>
          </Button>
        }
      />
    );
  }

  const data = quote.data;
  const priced = new Map(
    data?.lines.map((l) => [`${l.itemId}:${[...l.optionIds].sort().join(":")}`, l]),
  );
  const issues = new Map(data?.issues.map((i) => [i.itemId, i.code]));
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/s/${store.slug}`} className="text-title text-action hover:underline">
        {store.name}
      </Link>
      <Sheet>
        <ul className="flex flex-col" aria-busy={quote.isFetching}>
          {lines.map((line, index) => {
            const server = priced.get(`${line.itemId}:${[...line.optionIds].sort().join(":")}`);
            const issue = issues.get(line.itemId);
            return (
              <li key={line.key}>
                <SheetSection first={index === 0} className="flex items-center gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-body text-ink font-semibold">{line.name}</span>
                    {line.optionNames.length > 0 ? (
                      <span className="text-record text-ink-muted">
                        {line.optionNames.join(", ")}
                      </span>
                    ) : null}
                    {issue ? (
                      <span className="text-record text-seal font-semibold">
                        {t(`issue.${issue}`)}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-tap min-w-tap px-0"
                      aria-label={`${t("remove")}: ${line.name}`}
                      onClick={() => setQuantity(line.key, line.quantity - 1)}
                    >
                      <Minus aria-hidden className="size-4" />
                    </Button>
                    <span className="text-body w-6 text-center font-mono font-semibold tabular-nums">
                      {line.quantity}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-tap min-w-tap px-0"
                      aria-label={`+1 ${line.name}`}
                      onClick={() => setQuantity(line.key, line.quantity + 1)}
                    >
                      <Plus aria-hidden className="size-4" />
                    </Button>
                  </div>
                  <span className="w-20 text-right" data-testid="line-total">
                    <Price
                      value={server ? formatPeso(server.lineTotalCentavos) : "—"}
                      className="font-semibold"
                    />
                  </span>
                </SheetSection>
              </li>
            );
          })}
        </ul>
      </Sheet>

      {quote.isError ? <FormError message={quote.error.message} /> : null}
      {data ? (
        <Sheet>
          <SheetSection first className="flex flex-col gap-2" data-testid="quote">
            <Row label={t("subtotal")} value={data.subtotalCentavos} />
            <Row label={t("delivery")} value={data.deliveryFeeCentavos} />
            {data.smallOrderFeeCentavos > 0 ? (
              <Row label={t("smallOrder")} value={data.smallOrderFeeCentavos} />
            ) : null}
            {data.serviceFeeCentavos > 0 ? (
              <Row label={t("service")} value={data.serviceFeeCentavos} />
            ) : null}
            <TotalRow label={t("total")} amount={formatPeso(data.totalCentavos)} />
          </SheetSection>
        </Sheet>
      ) : (
        <p className="text-ink-muted text-body">{t("pricing")}</p>
      )}
      {data && !data.deliverable ? <FormError message={t("notDeliverable")} /> : null}
      <p className="text-label text-ink-muted">{t("priceNote")}</p>
      {data?.deliverable && data.issues.length === 0 ? (
        <Button size="tap" asChild>
          <Link href="/checkout">{t("checkout")}</Link>
        </Button>
      ) : (
        <Button size="tap" disabled>
          {t("checkout")}
        </Button>
      )}
    </div>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: number }): JSX.Element {
  return (
    <div className="text-body text-ink flex justify-between">
      <span>{label}</span>
      <Price value={formatPeso(value)} />
    </div>
  );
}
