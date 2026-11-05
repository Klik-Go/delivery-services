"use client";

import { centavosToPesoInput } from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { AlertTriangle, Camera, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { requestJson } from "@/lib/post-json";

interface Draft {
  readonly category: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceCentavos: number;
  readonly confidence: number;
}

interface Row {
  keep: boolean;
  category: string;
  name: string;
  description: string;
  price: string;
  confidence: number;
}

/** Below this, the row is flagged "Please check". */
const LOW_CONFIDENCE = 0.75;
const cellClass =
  "border-ink-muted/40 focus:border-brand-800 text-ink min-h-tap w-full rounded-xl border-2 bg-white px-2";

/**
 * "Import menu from a photo": upload → editable drafts with confidence → the merchant confirms.
 * Nothing is saved until "Add N items" (the review step is the point of the feature).
 */
export function MenuImport({ merchantId }: { readonly merchantId: string }): JSX.Element {
  const t = useTranslations("MenuImport");
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<"reading" | "saving" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<number | null>(null);
  const base = `/api/merchant/${merchantId}/menu/import`;

  async function read(): Promise<void> {
    if (!file) return;
    setBusy("reading");
    setError(null);
    setAdded(null);
    const form = new FormData();
    form.append("photo", file);
    const result = await requestJson<Draft[]>("POST", base, form, t("failed"));
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setRows(
      result.data.map((draft) => ({
        keep: true,
        category: draft.category,
        name: draft.name,
        description: draft.description ?? "",
        price: centavosToPesoInput(draft.priceCentavos),
        confidence: draft.confidence,
      })),
    );
  }

  async function confirm(): Promise<void> {
    if (!rows) return;
    setBusy("saving");
    setError(null);
    const items = rows
      .filter((row) => row.keep)
      .map((row) => ({
        category: row.category,
        name: row.name,
        price: row.price,
        ...(row.description ? { description: row.description } : {}),
      }));
    const result = await requestJson<{ created: number }>(
      "POST",
      `${base}/confirm`,
      { items },
      t("failed"),
    );
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setAdded(result.data.created);
    setRows(null);
    setFile(null);
  }

  function update(index: number, change: Partial<Row>): void {
    setRows(
      (current) => current?.map((row, i) => (i === index ? { ...row, ...change } : row)) ?? null,
    );
  }

  const kept = rows?.filter((row) => row.keep).length ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-muted flex items-start gap-2 text-sm">
        <ShieldCheck aria-hidden className="text-brand-800 size-5 shrink-0" />
        {t("privacy")}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
          {t("photo")}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="text-ink min-h-tap text-sm"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <Button onClick={() => void read()} disabled={!file || busy !== null}>
          <Camera aria-hidden className="size-5" />
          {busy === "reading" ? t("reading") : t("read")}
        </Button>
      </div>
      <FormError message={error} />
      {added !== null ? (
        <p aria-live="polite" className="text-brand-800 font-semibold">
          {t("done", { count: added })}
        </p>
      ) : null}

      {rows && rows.length === 0 ? <p className="text-ink-muted">{t("none")}</p> : null}
      {rows && rows.length > 0 ? (
        <section aria-labelledby="review-heading" className="flex flex-col gap-3">
          <h2 id="review-heading" className="text-ink text-xl font-bold">
            {t("review")}
          </h2>
          <p className="text-ink-muted text-sm">{t("reviewLead")}</p>
          <ul className="flex flex-col gap-3">
            {rows.map((row, index) => {
              const low = row.confidence < LOW_CONFIDENCE;
              return (
                <li
                  key={index}
                  className={`rounded-card flex flex-col gap-2 border-2 p-3 ${low ? "border-accent-400 bg-accent-50" : "border-brand-100"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-ink flex items-center gap-2 font-semibold">
                      <input
                        type="checkbox"
                        className="accent-brand-800 size-5"
                        checked={row.keep}
                        onChange={(event) => update(index, { keep: event.target.checked })}
                        aria-label={t("keep", { name: row.name })}
                      />
                      {row.name}
                    </label>
                    <span className="text-ink-muted flex items-center gap-1 text-xs">
                      {low ? <AlertTriangle aria-hidden className="text-ink size-4" /> : null}
                      {low ? `${t("check")} · ` : ""}
                      {t("confidence", { percent: Math.round(row.confidence * 100) })}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <input
                      aria-label={`${row.name}: name`}
                      className={`${cellClass} col-span-2`}
                      value={row.name}
                      onChange={(event) => update(index, { name: event.target.value })}
                    />
                    <input
                      aria-label={`${row.name}: price`}
                      inputMode="decimal"
                      className={cellClass}
                      value={row.price}
                      onChange={(event) => update(index, { price: event.target.value })}
                    />
                    <input
                      aria-label={`${row.name}: category`}
                      className={cellClass}
                      value={row.category}
                      onChange={(event) => update(index, { category: event.target.value })}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <Button onClick={() => void confirm()} disabled={kept === 0 || busy !== null} size="lg">
            {busy === "saving" ? t("confirming") : t("confirm", { count: kept })}
          </Button>
        </section>
      ) : null}
    </div>
  );
}
