"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { formatPeso, type PabiliOptions, type PabiliQuote, type PlacedPabili } from "@klikgo/core";
import {
  PabiliFormSchema,
  type CheckoutAddress,
  type PabiliFormInput,
  type PabiliQuoteRequest,
} from "@klikgo/types";
import { Button } from "@klikgo/ui";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type JSX } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { FormError } from "@/components/auth/form-error";
import { TextField } from "@/components/auth/text-field";
import type { Pin } from "@/components/map/pin-map";
import { requestJson } from "@/lib/post-json";
import { trackFunnel } from "@/lib/telemetry";

// Leaflet only runs in the browser.
const PinMap = dynamic(() => import("@/components/map/pin-map").then((m) => m.PinMap), {
  ssr: false,
});

/** Waits until typing stops before asking the server for a new price. */
function useSettled<T>(value: T, ms = 400): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** The address fields as the form edits them (empty strings for blanks). */
export type PabiliAddressDraft = { [K in keyof CheckoutAddress]-?: string };

const nonEmpty = (address: CheckoutAddress): CheckoutAddress =>
  Object.fromEntries(
    Object.entries(address).filter(([, value]) => typeof value === "string" && value.trim()),
  ) as CheckoutAddress;

/**
 * Pabili ("buy for me", Phase 13): where to buy (name, notes and a pin), the shopping list in the
 * customer's own words, the most the rider may spend, and where to deliver. The fees come from
 * /api/pabili/quote; the customer pays the receipt total plus the fees in cash at the door.
 */
export function PabiliForm({
  options,
  dropoff,
  initialAddress,
}: {
  readonly options: PabiliOptions;
  readonly dropoff: Pin | null;
  readonly initialAddress: PabiliAddressDraft;
}): JSX.Element {
  const t = useTranslations("Pabili.form");
  const tCheckout = useTranslations("Customer.checkout");
  const tPilot = useTranslations("Pilot.checkout");
  const router = useRouter();
  const [pickup, setPickup] = useState<Pin | null>(dropoff);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ key: string; body: string } | null>(null);
  const form = useForm<z.input<typeof PabiliFormSchema>, unknown, PabiliFormInput>({
    resolver: standardSchemaResolver(PabiliFormSchema),
    defaultValues: {
      storeName: "",
      storeNotes: "",
      items: [{ description: "", quantity: 1, note: "" }],
      address: initialAddress,
    },
  });
  const lines = useFieldArray({ control: form.control, name: "items" });
  const watched = useWatch({ control: form.control });

  const request: PabiliQuoteRequest | null =
    pickup && dropoff && watched.storeName?.trim() && (watched.budgetPesos ?? 0) > 0
      ? {
          storeName: watched.storeName.trim(),
          pickup,
          dropoff,
          budgetCentavos: Math.round((watched.budgetPesos ?? 0) * 100),
          items: (watched.items ?? [])
            .filter((line) => line.description?.trim())
            .map((line) => ({
              description: line.description?.trim() ?? "",
              quantity: line.quantity && line.quantity > 0 ? line.quantity : 1,
            })),
        }
      : null;
  const settled = useSettled(request && request.items.length > 0 ? request : null);
  const quote = useQuery({
    queryKey: ["pabili-quote", settled],
    enabled: settled !== null,
    placeholderData: (previous) => previous,
    retry: false,
    queryFn: async () => {
      const result = await requestJson<PabiliQuote>(
        "POST",
        "/api/pabili/quote",
        settled,
        t("pricing"),
      );
      if (!result.ok) throw new Error(result.message);
      return result.data;
    },
  });

  if (!dropoff) {
    return (
      <Link href="/address" className="text-action font-semibold">
        {t("needAddress")}
      </Link>
    );
  }

  const place = async (input: PabiliFormInput): Promise<void> => {
    if (!pickup) return;
    setError(null);
    const payload = {
      storeName: input.storeName,
      ...(input.storeNotes ? { storeNotes: input.storeNotes } : {}),
      pickup,
      dropoff,
      budgetCentavos: input.budgetPesos * 100,
      items: input.items.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        ...(line.note ? { note: line.note } : {}),
      })),
      address: nonEmpty(input.address),
    };
    const body = JSON.stringify(payload);
    // Same list → same key (the server answers with the order it already made).
    if (attempt.current?.body !== body) attempt.current = { key: crypto.randomUUID(), body };
    setPlacing(true);
    const result = await requestJson<PlacedPabili>(
      "POST",
      "/api/pabili/orders",
      payload,
      t("failed"),
      {
        "Idempotency-Key": attempt.current.key,
      },
    );
    if (!result.ok) {
      setPlacing(false);
      setError(result.message);
      return;
    }
    trackFunnel({ name: "order_placed", orderId: result.data.orderId });
    router.push(`/orders/${result.data.orderId}`);
  };

  const data = quote.data;
  const errors = form.formState.errors;
  const full = lines.fields.length >= options.maxItems;

  return (
    <form
      className="flex flex-col gap-6 pb-28"
      noValidate
      onSubmit={(event) => void form.handleSubmit(place)(event)}
    >
      <section aria-labelledby="pabili-where" className="flex flex-col gap-3">
        <h2 id="pabili-where" className="text-ink text-lg font-bold">
          {t("where")}
        </h2>
        <TextField
          id="pabili-store"
          label={t("storeName")}
          placeholder={t("storeNameHint")}
          error={errors.storeName?.message}
          {...form.register("storeName")}
        />
        <TextField
          id="pabili-store-notes"
          label={t("storeNotes")}
          placeholder={t("storeNotesHint")}
          error={errors.storeNotes?.message}
          {...form.register("storeNotes")}
        />
        <p className="text-ink-muted text-sm">{t("pinHint")}</p>
        <PinMap value={pickup ?? dropoff} onChange={setPickup} label={t("mapLabel")} />
      </section>

      <section aria-labelledby="pabili-list" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="pabili-list" className="text-ink text-lg font-bold">
            {t("list")}
          </h2>
          <span className="text-ink-muted text-sm">
            {t("count", { count: lines.fields.length, max: options.maxItems })}
          </span>
        </div>
        <ol className="flex flex-col gap-3">
          {lines.fields.map((field, index) => (
            <li
              key={field.id}
              className="bg-surface-muted flex flex-col gap-2 rounded-xl p-3"
              data-testid="pabili-item"
            >
              <div className="grid grid-cols-[1fr_5rem] gap-2">
                <TextField
                  id={`pabili-item-${String(index)}`}
                  label={t("item", { n: index + 1 })}
                  placeholder={t("itemHint")}
                  error={errors.items?.[index]?.description?.message}
                  {...form.register(`items.${index}.description`)}
                />
                <TextField
                  id={`pabili-qty-${String(index)}`}
                  label={t("quantity")}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={99}
                  error={errors.items?.[index]?.quantity?.message}
                  {...form.register(`items.${index}.quantity`, { valueAsNumber: true })}
                />
              </div>
              <TextField
                id={`pabili-note-${String(index)}`}
                label={t("note")}
                placeholder={t("noteHint")}
                error={errors.items?.[index]?.note?.message}
                {...form.register(`items.${index}.note`)}
              />
              {lines.fields.length > 1 ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="self-start"
                  onClick={() => lines.remove(index)}
                  aria-label={t("remove", { n: index + 1 })}
                >
                  <Trash2 aria-hidden className="size-4" /> {t("removeShort")}
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
        {errors.items?.root?.message || errors.items?.message ? (
          <FormError message={errors.items.root?.message ?? errors.items.message ?? ""} />
        ) : null}
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          disabled={full}
          onClick={() => lines.append({ description: "", quantity: 1, note: "" })}
        >
          <Plus aria-hidden className="size-4" /> {t("add")}
        </Button>
      </section>

      <section aria-labelledby="pabili-budget" className="flex flex-col gap-2">
        <h2 id="pabili-budget" className="text-ink text-lg font-bold">
          {t("budgetTitle")}
        </h2>
        <TextField
          id="pabili-budget-input"
          label={t("budget")}
          type="number"
          inputMode="numeric"
          min={1}
          max={options.maxItemCentavos / 100}
          error={errors.budgetPesos?.message}
          {...form.register("budgetPesos", { valueAsNumber: true })}
        />
        <p className="text-ink-muted text-sm">
          {t("budgetHint", { max: formatPeso(options.maxItemCentavos) })}
        </p>
      </section>

      <section aria-labelledby="pabili-deliver" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 id="pabili-deliver" className="text-ink text-lg font-bold">
            {tCheckout("deliverTo")}
          </h2>
          <Link
            href="/address"
            className="text-action min-h-tap inline-flex items-center font-semibold"
          >
            {tCheckout("changePin")}
          </Link>
        </div>
        <TextField
          id="pabili-label"
          label={tCheckout("label")}
          error={errors.address?.label?.message}
          {...form.register("address.label")}
        />
        <TextField
          id="pabili-landmark"
          label={tCheckout("landmark")}
          placeholder={tCheckout("landmarkHint")}
          error={errors.address?.landmark?.message}
          {...form.register("address.landmark")}
        />
        <TextField
          id="pabili-phone"
          label={tCheckout("contactPhone")}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          error={errors.address?.contactPhone?.message}
          {...form.register("address.contactPhone")}
        />
        <TextField
          id="pabili-notes"
          label={tCheckout("notes")}
          error={errors.address?.notes?.message}
          {...form.register("address.notes")}
        />
      </section>

      <section
        aria-labelledby="pabili-summary"
        className="bg-surface-muted flex flex-col gap-2 rounded-xl p-4"
        data-testid="pabili-summary"
      >
        <h2 id="pabili-summary" className="text-ink text-lg font-bold">
          {t("summary")}
        </h2>
        {quote.isError ? <FormError message={quote.error.message} /> : null}
        {data ? (
          <dl className="flex flex-col gap-1">
            <div className="flex justify-between">
              <dt className="text-ink">{t("deliveryFee")}</dt>
              <dd className="text-ink">{formatPeso(data.deliveryFeeCentavos)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink">{t("serviceFee")}</dt>
              <dd className="text-ink">{formatPeso(data.serviceFeeCentavos)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink">{t("items")}</dt>
              <dd className="text-ink">{t("upTo", { amount: formatPeso(data.budgetCentavos) })}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink font-bold">{t("maxToPay")}</dt>
              <dd className="text-ink font-bold" data-testid="pabili-max">
                {formatPeso(data.maxToPayCentavos)}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-ink-muted text-sm">{t("fillIn")}</p>
        )}
        <p className="text-ink text-sm">{t("cashOnly")}</p>
        {data?.inviteRequired ? (
          <p className="text-ink text-sm">
            {tPilot("inviteRequired")}{" "}
            <Link href="/join?next=/pabili" className="text-action font-semibold">
              {tPilot("enterCode")}
            </Link>
          </p>
        ) : null}
      </section>

      {error ? <FormError message={error} /> : null}
      <div className="bg-surface fixed inset-x-0 bottom-0 border-t p-4">
        <div className="mx-auto max-w-screen-sm">
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={placing || !data || data.inviteRequired}
          >
            {placing
              ? t("placing")
              : data
                ? t("place", { amount: formatPeso(data.feesCentavos) })
                : t("placeIdle")}
          </Button>
        </div>
      </div>
    </form>
  );
}
