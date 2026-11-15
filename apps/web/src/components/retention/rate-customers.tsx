"use client";

import type { RiderDeliveryToRate } from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { Star } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { fetchData, postJson } from "@/lib/post-json";
import { draftBody, EMPTY_DRAFT, RatingForm, type RatingDraft } from "./rating-form";

/**
 * "Rate your customers": the rider's deliveries of the last 7 days, each rateable once (and
 * changeable for 24 hours). Riders' ratings of customers are seen by the platform only.
 */
export function RateCustomers(): JSX.Element | null {
  const t = useTranslations("Retention.riderRating");
  const list = useQuery({
    queryKey: ["rider-ratings"],
    queryFn: () => fetchData<RiderDeliveryToRate[]>("/api/rider/ratings", t("failed")),
  });
  if (list.isPending || list.isError || list.data.length === 0) return null;
  return (
    <section className="flex flex-col gap-3" data-testid="rate-customers">
      <h2 className="text-ink text-lg font-bold">{t("title")}</h2>
      <p className="text-ink-muted text-sm">{t("lead")}</p>
      <ul className="flex flex-col gap-3">
        {list.data.map((delivery) => (
          <DeliveryRating key={delivery.orderId} delivery={delivery} />
        ))}
      </ul>
    </section>
  );
}

function DeliveryRating({ delivery }: { readonly delivery: RiderDeliveryToRate }): JSX.Element {
  const t = useTranslations("Retention.riderRating");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RatingDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rating = delivery.rating;
  const editable = !rating || rating.editableUntil !== null;

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await postJson<RiderDeliveryToRate>(
      `/api/rider/ratings/${delivery.orderId}`,
      draftBody(draft),
      t("failed"),
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setOpen(false);
    void queryClient.invalidateQueries({ queryKey: ["rider-ratings"] });
  };

  return (
    <li
      className="border-border flex flex-col gap-2 rounded-xl border p-3"
      data-delivery={delivery.code}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-ink font-semibold">{delivery.code}</p>
          <p className="text-ink-muted text-sm">{delivery.merchantName}</p>
        </div>
        {rating ? (
          <span className="text-ink flex items-center gap-1 font-semibold">
            <Star aria-hidden className="fill-accent-400 text-ink size-4" />
            {rating.score}
          </span>
        ) : null}
      </div>
      {open ? (
        <>
          <RatingForm
            target="customer"
            label={t("customer")}
            draft={draft}
            onChange={setDraft}
            disabled={busy}
          />
          {error ? <FormError message={error} /> : null}
          <Button disabled={busy || draft.score === 0} onClick={() => void save()}>
            {t("send")}
          </Button>
        </>
      ) : editable ? (
        <Button
          variant="secondary"
          onClick={() => {
            setDraft(
              rating
                ? { score: rating.score, tags: rating.tags, comment: rating.comment ?? "" }
                : EMPTY_DRAFT,
            );
            setOpen(true);
          }}
        >
          {rating ? t("change") : t("rate")}
        </Button>
      ) : null}
    </li>
  );
}
