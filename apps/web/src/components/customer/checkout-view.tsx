"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { formatPeso, type CheckoutQuote, type PlacedOrder } from "@klikgo/core";
import {
  CheckoutAddressSchema,
  TIP_PRESETS_CENTAVOS,
  type CheckoutAddress,
  type PaymentMethod,
} from "@klikgo/types";
import { Button } from "@klikgo/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, type JSX } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { FormError } from "@/components/auth/form-error";
import { TextField } from "@/components/auth/text-field";
import { useCart } from "@/lib/cart-store";
import { requestJson } from "@/lib/post-json";
import { useHydrated } from "@/lib/use-hydrated";

/** The address fields as the form edits them (empty strings for blanks). */
export type CheckoutAddressDraft = { [K in keyof CheckoutAddress]-?: string };

type When = "asap" | "schedule";

const PROMO_PATTERN = /^[A-Z0-9]{4,20}$/;

/**
 * Checkout on one screen. Every amount comes from /api/checkout/quote; "Place order" sends ids
 * and choices only, with one Idempotency-Key per attempt so a double tap or a retry after a
 * dropped connection returns the same order instead of a second one.
 */
export function CheckoutView({
  dropoff,
  initialAddress,
}: {
  readonly dropoff: { lat: number; lng: number } | null;
  readonly initialAddress: CheckoutAddressDraft;
}): JSX.Element {
  const t = useTranslations("Customer.checkout");
  const tCart = useTranslations("Customer.cart");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const { store, lines, clear } = useCart();
  const [promoInput, setPromoInput] = useState("");
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [tipCentavos, setTipCentavos] = useState(0);
  const [chosenMethod, setChosenMethod] = useState<PaymentMethod | null>(null);
  const [chosenWhen, setChosenWhen] = useState<When | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ key: string; body: string } | null>(null);
  const form = useForm<z.input<typeof CheckoutAddressSchema>, unknown, CheckoutAddress>({
    resolver: standardSchemaResolver(CheckoutAddressSchema),
    defaultValues: initialAddress,
  });

  const cart =
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
  const quoteRequest = cart ? { ...cart, tipCentavos, ...(promoCode ? { promoCode } : {}) } : null;
  const quote = useQuery({
    queryKey: ["checkout-quote", quoteRequest],
    enabled: quoteRequest !== null,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const result = await requestJson<CheckoutQuote>(
        "POST",
        "/api/checkout/quote",
        quoteRequest,
        tCart("pricing"),
      );
      if (!result.ok) throw new Error(result.message);
      return result.data;
    },
  });

  if (!hydrated) return <p className="text-ink-muted">{tCart("pricing")}</p>;
  if (!store || lines.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-ink-muted">{tCart("empty")}</p>
        <Link href="/" className="text-brand-800 font-semibold underline">
          {tCart("browse")}
        </Link>
      </div>
    );
  }
  if (!dropoff) {
    return (
      <Link href="/address" className="text-brand-800 font-semibold underline">
        {tCart("needAddress")}
      </Link>
    );
  }

  const data = quote.data;
  const open = data?.quote.opening.open ?? true;
  const when: When = chosenWhen ?? (open ? "asap" : "schedule");
  const slots = data?.slots ?? [];
  const chosenSlot = slot && slots.includes(slot) ? slot : (slots[0] ?? null);
  const methods = data?.paymentMethods ?? [];
  const method = chosenMethod && methods.includes(chosenMethod) ? chosenMethod : methods[0];
  const timeFormat = new Intl.DateTimeFormat(locale === "fil" ? "fil-PH" : "en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  });
  const canPlace =
    data !== undefined &&
    data.quote.deliverable &&
    data.quote.issues.length === 0 &&
    method !== undefined &&
    (when === "asap" ? open : chosenSlot !== null) &&
    !placing;

  const place = async (address: CheckoutAddress): Promise<void> => {
    if (!cart || !method || !data) return;
    setError(null);
    const payload = {
      ...cart,
      tipCentavos,
      ...(promoCode && data.promo ? { promoCode } : {}),
      paymentMethod: method,
      address: Object.fromEntries(
        Object.entries(address).filter(([, value]) => typeof value === "string" && value.trim()),
      ),
      ...(when === "schedule" && chosenSlot ? { scheduledFor: chosenSlot } : {}),
    };
    const body = JSON.stringify(payload);
    // Same choices → same key (the server answers with the order it already made).
    if (attempt.current?.body !== body) attempt.current = { key: crypto.randomUUID(), body };
    setPlacing(true);
    const result = await requestJson<PlacedOrder>("POST", "/api/orders", payload, t("failed"), {
      "Idempotency-Key": attempt.current.key,
    });
    if (!result.ok) {
      setPlacing(false);
      setError(result.message);
      return;
    }
    clear();
    if (result.data.checkoutUrl) window.location.assign(result.data.checkoutUrl);
    else router.push(`/orders/${result.data.orderId}`);
  };

  const chip = (active: boolean): string =>
    `min-h-tap rounded-full px-4 text-sm font-semibold ${active ? "bg-brand-800 text-white" : "bg-surface-muted text-ink"}`;

  return (
    <form
      className="flex flex-col gap-6 pb-28"
      noValidate
      onSubmit={(event) => void form.handleSubmit(place)(event)}
    >
      <section aria-labelledby="deliver-to" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 id="deliver-to" className="text-ink text-lg font-bold">
            {t("deliverTo")}
          </h2>
          <Link
            href="/address"
            className="text-brand-800 min-h-tap inline-flex items-center font-semibold underline"
          >
            {t("changePin")}
          </Link>
        </div>
        <TextField
          label={t("label")}
          error={form.formState.errors.label?.message}
          {...form.register("label")}
        />
        <TextField
          label={t("landmark")}
          placeholder={t("landmarkHint")}
          error={form.formState.errors.landmark?.message}
          {...form.register("landmark")}
        />
        <TextField
          label={t("contactPhone")}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          error={form.formState.errors.contactPhone?.message}
          {...form.register("contactPhone")}
        />
        <TextField
          label={t("notes")}
          error={form.formState.errors.notes?.message}
          {...form.register("notes")}
        />
      </section>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-ink mb-2 text-lg font-bold">{t("when")}</legend>
        {!open ? <p className="text-ink-muted text-sm">{t("closed")}</p> : null}
        <div className="flex flex-wrap gap-2">
          {open ? (
            <button
              type="button"
              className={chip(when === "asap")}
              aria-pressed={when === "asap"}
              onClick={() => setChosenWhen("asap")}
            >
              {t("asap")}
            </button>
          ) : null}
          <button
            type="button"
            className={chip(when === "schedule")}
            aria-pressed={when === "schedule"}
            onClick={() => setChosenWhen("schedule")}
          >
            {t("schedule")}
          </button>
        </div>
        {when === "schedule" ? (
          slots.length > 0 ? (
            <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
              {t("slot")}
              <select
                className="border-ink-muted/40 text-ink min-h-tap rounded-xl border-2 bg-white px-3 text-base"
                value={chosenSlot ?? ""}
                onChange={(event) => setSlot(event.target.value)}
              >
                {slots.map((s) => (
                  <option key={s} value={s}>
                    {timeFormat.format(new Date(s))}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-ink-muted text-sm">{t("noSlots")}</p>
          )
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-ink mb-2 text-lg font-bold">{t("payment")}</legend>
        {methods.map((m) => (
          <label
            key={m}
            className="bg-surface-muted min-h-tap flex items-center gap-3 rounded-xl px-4 py-2"
          >
            <input
              type="radio"
              name="paymentMethod"
              value={m}
              checked={method === m}
              onChange={() => setChosenMethod(m)}
              className="accent-brand-800 size-5"
            />
            <span className="text-ink font-semibold">{t(`method.${m}`)}</span>
          </label>
        ))}
        {method ? (
          <p className="text-ink-muted text-sm">
            {method === "cod" ? t("codNote") : t("onlineNote")}
          </p>
        ) : null}
      </fieldset>

      <section aria-labelledby="promo" className="flex flex-col gap-2">
        <h2 id="promo" className="text-ink text-lg font-bold">
          {t("promo")}
        </h2>
        {promoCode && data?.promo ? (
          <div className="flex items-center justify-between">
            <span className="text-ink font-semibold">
              {t("promoApplied", { code: data.promo.code })}
            </span>
            <Button type="button" variant="ghost" onClick={() => setPromoCode(null)}>
              {t("removePromo")}
            </Button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextField
                label={t("promo")}
                name="promoCode"
                autoCapitalize="characters"
                value={promoInput}
                onChange={(event) => setPromoInput(event.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={!PROMO_PATTERN.test(promoInput.trim().toUpperCase())}
              onClick={() => setPromoCode(promoInput.trim().toUpperCase())}
            >
              {t("apply")}
            </Button>
          </div>
        )}
        {promoCode && data?.promoError ? <FormError message={data.promoError} /> : null}
      </section>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-ink mb-2 text-lg font-bold">{t("tip")}</legend>
        <div className="flex flex-wrap gap-2">
          {[0, ...TIP_PRESETS_CENTAVOS].map((amount) => (
            <button
              key={amount}
              type="button"
              className={chip(tipCentavos === amount)}
              aria-pressed={tipCentavos === amount}
              onClick={() => setTipCentavos(amount)}
            >
              {amount === 0 ? t("noTip") : formatPeso(amount)}
            </button>
          ))}
        </div>
        <p className="text-ink-muted text-sm">{t("tipNote")}</p>
      </fieldset>

      {quote.isError ? <FormError message={quote.error.message} /> : null}
      {data ? (
        <dl
          className="flex flex-col gap-1"
          data-testid="checkout-summary"
          aria-busy={quote.isFetching}
        >
          <Row label={tCart("subtotal")} value={data.quote.subtotalCentavos} />
          <Row label={tCart("delivery")} value={data.quote.deliveryFeeCentavos} />
          {data.quote.smallOrderFeeCentavos > 0 ? (
            <Row label={tCart("smallOrder")} value={data.quote.smallOrderFeeCentavos} />
          ) : null}
          {data.quote.serviceFeeCentavos > 0 ? (
            <Row label={tCart("service")} value={data.quote.serviceFeeCentavos} />
          ) : null}
          {data.promo ? <Row label={t("discount")} value={-data.promo.discountCentavos} /> : null}
          {data.tipCentavos > 0 ? <Row label={t("tipLine")} value={data.tipCentavos} /> : null}
          <Row label={tCart("total")} value={data.totalCentavos} strong />
        </dl>
      ) : (
        <p className="text-ink-muted">{tCart("pricing")}</p>
      )}
      {data && !data.quote.deliverable ? <FormError message={tCart("notDeliverable")} /> : null}
      {error ? <FormError message={error} /> : null}

      <div className="bg-surface fixed inset-x-0 bottom-0 border-t px-4 py-3">
        <Button
          type="submit"
          size="lg"
          className="mx-auto flex w-full max-w-screen-sm"
          disabled={!canPlace}
        >
          {placing
            ? t("placing")
            : t("place", { total: data ? formatPeso(data.totalCentavos) : "…" })}
        </Button>
      </div>
    </form>
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
      <dd>{value < 0 ? `−${formatPeso(-value)}` : formatPeso(value)}</dd>
    </div>
  );
}
