"use client";

import type { OrderRatingSheet, RatingView } from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { Star } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { fetchData, postJson } from "@/lib/post-json";
import { draftBody, EMPTY_DRAFT, RatingForm, type RatingDraft } from "./rating-form";

const fromView = (view: RatingView | null): RatingDraft =>
  view ? { score: view.score, tags: view.tags, comment: view.comment ?? "" } : EMPTY_DRAFT;

/**
 * "How was your order?": the customer rates the store and the rider separately after delivery
 * (docs/BUSINESS.md §5.3). Ratings can be changed for 24 hours and close 7 days after delivery.
 */
export function RatingSheet({ orderId }: { readonly orderId: string }): JSX.Element | null {
  const t = useTranslations("Retention.rating");
  const queryClient = useQueryClient();
  const sheet = useQuery({
    queryKey: ["ratings", orderId],
    queryFn: () => fetchData<OrderRatingSheet>(`/api/orders/${orderId}/ratings`, t("failed")),
  });
  const [merchant, setMerchant] = useState<RatingDraft | null>(null);
  const [rider, setRider] = useState<RatingDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (sheet.isPending) return <p className="text-ink-muted">{t("loading")}</p>;
  if (sheet.isError) return <FormError message={sheet.error.message} />;
  const s = sheet.data;
  const merchantEditable =
    s.open && (!s.merchant.rating || s.merchant.rating.editableUntil !== null);
  const riderEditable =
    s.rider !== null && s.open && (!s.rider.rating || s.rider.rating.editableUntil !== null);
  const merchantDraft = merchant ?? fromView(s.merchant.rating);
  const riderDraft = rider ?? fromView(s.rider?.rating ?? null);

  if (!merchantEditable && !riderEditable) {
    const given = [s.merchant.rating, s.rider?.rating ?? null].filter(
      (r): r is RatingView => r !== null,
    );
    return (
      <section
        className="bg-surface-muted flex flex-col gap-2 rounded-xl p-4"
        data-testid="rating-sheet"
      >
        <h2 className="text-ink text-lg font-bold">{t("title")}</h2>
        {given.length === 0 ? (
          <p className="text-ink-muted">{t("closed")}</p>
        ) : (
          <p className="text-ink flex items-center gap-1">
            <Star aria-hidden className="fill-accent-400 text-ink size-5" />
            {t("thanks")}
          </p>
        )}
      </section>
    );
  }

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setSaved(false);
    const body = {
      ...(merchantEditable && merchantDraft.score > 0
        ? { merchant: draftBody(merchantDraft) }
        : {}),
      ...(riderEditable && riderDraft.score > 0 ? { rider: draftBody(riderDraft) } : {}),
    };
    const result = await postJson<OrderRatingSheet>(
      `/api/orders/${orderId}/ratings`,
      body,
      t("failed"),
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSaved(true);
    setMerchant(null);
    setRider(null);
    queryClient.setQueryData(["ratings", orderId], result.data);
    void queryClient.invalidateQueries({ queryKey: ["order-history"] });
  };

  const anyScore =
    (merchantEditable && merchantDraft.score > 0) || (riderEditable && riderDraft.score > 0);
  const editing = s.merchant.rating !== null || s.rider?.rating;
  return (
    <section
      className="bg-surface-muted flex flex-col gap-4 rounded-xl p-4"
      data-testid="rating-sheet"
    >
      <div>
        <h2 className="text-ink text-lg font-bold">{t("title")}</h2>
        <p className="text-ink-muted text-sm">{editing ? t("editNote") : t("lead")}</p>
      </div>
      {merchantEditable ? (
        <RatingForm
          target="merchant"
          label={t("store", { name: s.merchant.name })}
          draft={merchantDraft}
          onChange={setMerchant}
          disabled={busy}
        />
      ) : null}
      {riderEditable && s.rider ? (
        <RatingForm
          target="rider"
          label={s.rider.name ? t("riderNamed", { name: s.rider.name }) : t("rider")}
          draft={riderDraft}
          onChange={setRider}
          disabled={busy}
        />
      ) : null}
      {error ? <FormError message={error} /> : null}
      {saved ? (
        <p role="status" className="text-ink font-semibold">
          {t("saved")}
        </p>
      ) : null}
      <Button disabled={busy || !anyScore} onClick={() => void submit()}>
        {editing ? t("update") : t("send")}
      </Button>
    </section>
  );
}
