"use client";

import { formatPeso, type RiderJobView } from "@klikgo/core";
import type { PabiliItemStatus } from "@klikgo/types";
import { useTranslations } from "next-intl";
import { useState, type JSX } from "react";
import { compressToWebp } from "@/lib/compress-image";
import { requestJson } from "@/lib/post-json";
import { SwipeConfirm } from "./swipe-confirm";

type Wire<T> = {
  [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K];
};

type Outcome = Exclude<PabiliItemStatus, "pending">;

/** Turns "312.50" or "312" into centavos; null when it isn't an amount. */
export function pesosToCentavos(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole = "0", cents = ""] = trimmed.split(".");
  return Number(whole) * 100 + Number(cents.padEnd(2, "0"));
}

/**
 * The shop part of a Pabili job: start shopping at the shop, tick each line bought or not
 * available, enter the receipt total (never more than the customer's budget) and photograph the
 * receipt; then pick up as usual. Amounts and checks come back from the server.
 */
export function PabiliShopping({
  job,
  busy,
  call,
  onError,
  refresh,
}: {
  readonly job: Wire<RiderJobView>;
  readonly busy: boolean;
  readonly call: (path: string, body?: unknown) => Promise<boolean>;
  readonly onError: (message: string | null) => void;
  readonly refresh: () => void;
}): JSX.Element | null {
  const t = useTranslations("Pabili.rider");
  const tJob = useTranslations("Rider.job");
  const pabili = job.pabili;
  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>({});
  const [cost, setCost] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  if (!pabili) return null;
  const base = `/api/rider/jobs/${job.orderId}`;
  const answered = pabili.list.every((line) => outcomes[line.position] !== undefined);
  const costCentavos = pesosToCentavos(cost);
  const overBudget = costCentavos !== null && costCentavos > pabili.budgetCentavos;

  const record = async (): Promise<void> => {
    if (costCentavos === null || !receipt) return;
    setSending(true);
    onError(null);
    const form = new FormData();
    form.set("itemCostCentavos", String(costCentavos));
    form.set(
      "items",
      JSON.stringify(
        pabili.list.map((line) => ({ position: line.position, status: outcomes[line.position] })),
      ),
    );
    const small = await compressToWebp(receipt).catch(() => receipt);
    form.set("receipt", new File([small], "receipt.webp", { type: small.type || receipt.type }));
    const result = await requestJson<unknown>("POST", `${base}/bought`, form, t("failed"));
    setSending(false);
    if (!result.ok) onError(result.message);
    refresh();
  };

  return (
    <div className="flex flex-col gap-3" data-testid="pabili-shopping">
      <p
        className="bg-accent-400 text-ink rounded-xl p-3 font-semibold"
        data-testid="pabili-budget"
      >
        {t("budget", { amount: formatPeso(pabili.budgetCentavos) })}
      </p>
      {job.status === "accepted" ? (
        <>
          <ShoppingList job={job} />
          <SwipeConfirm
            label={t("startShopping")}
            disabled={busy}
            onConfirm={() => void call(`${base}/shopping`)}
          />
        </>
      ) : null}
      {job.status === "preparing" ? (
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(event) => event.preventDefault()}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="text-ink mb-1 font-bold">{t("listTitle")}</legend>
            {pabili.list.map((line) => (
              <div
                key={line.position}
                className="border-border flex flex-col gap-2 rounded-lg border p-3"
                data-testid="pabili-line"
              >
                <p className="text-ink font-semibold">
                  {line.quantity} × {line.description}
                </p>
                {line.note ? <p className="text-ink-muted text-sm">{line.note}</p> : null}
                <div className="flex gap-2" role="group" aria-label={line.description}>
                  {(["bought", "unavailable"] as const).map((outcome) => (
                    <button
                      key={outcome}
                      type="button"
                      aria-pressed={outcomes[line.position] === outcome}
                      onClick={() => setOutcomes((now) => ({ ...now, [line.position]: outcome }))}
                      className={`min-h-tap rounded-full px-4 text-sm font-semibold ${outcomes[line.position] === outcome ? "bg-brand-800 text-white" : "bg-surface-muted text-ink"}`}
                    >
                      {outcome === "bought" ? t("boughtOutcome") : t("unavailable")}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
          <label className="text-ink flex flex-col gap-1 font-semibold">
            {t("cost")}
            <input
              inputMode="decimal"
              value={cost}
              onChange={(event) => setCost(event.target.value.replace(/[^\d.]/g, ""))}
              aria-invalid={overBudget ? true : undefined}
              aria-describedby="pabili-cost-hint"
              className="border-border text-ink min-h-tap rounded-lg border px-3 text-lg"
            />
            <span
              id="pabili-cost-hint"
              className={overBudget ? "text-danger-900 text-sm" : "text-ink-muted text-sm"}
            >
              {overBudget
                ? t("overBudget", { amount: formatPeso(pabili.budgetCentavos) })
                : t("costHint")}
            </span>
          </label>
          <label className="text-ink flex flex-col gap-1 font-semibold">
            {t("receipt")}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(event) => setReceipt(event.target.files?.[0] ?? null)}
              className="text-ink text-sm"
            />
          </label>
          <SwipeConfirm
            label={t("bought")}
            disabled={sending || !answered || costCentavos === null || overBudget || !receipt}
            onConfirm={() => void record()}
          />
        </form>
      ) : null}
      {job.status === "ready" ? (
        <>
          <p className="text-ink" data-testid="pabili-recorded">
            {t("recorded", { amount: formatPeso(pabili.itemCostCentavos ?? 0) })}
          </p>
          <SwipeConfirm
            label={tJob("pickedUp")}
            disabled={busy}
            onConfirm={() => void call(`${base}/picked-up`)}
          />
        </>
      ) : null}
    </div>
  );
}

function ShoppingList({ job }: { readonly job: Wire<RiderJobView> }): JSX.Element {
  return (
    <ul className="text-ink list-disc pl-6 text-sm">
      {(job.pabili?.list ?? []).map((line) => (
        <li key={line.position}>
          {line.quantity} × {line.description}
          {line.note ? ` (${line.note})` : ""}
        </li>
      ))}
    </ul>
  );
}
