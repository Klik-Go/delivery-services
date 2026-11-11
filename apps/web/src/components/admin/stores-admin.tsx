"use client";

import type { OpsMerchant } from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { fetchData, requestJson } from "@/lib/post-json";
import type { Wire } from "./wire";

/** Live stores: suspend or reactivate with a reason, and schedule a commission change (admins). */
export function StoresAdmin({ isAdmin }: { readonly isAdmin: boolean }): JSX.Element {
  const tOps = useTranslations("Ops");
  const stores = useQuery({
    queryKey: ["ops-stores"],
    queryFn: () => fetchData<Wire<OpsMerchant>[]>("/api/admin/stores", tOps("failed")),
  });
  if (stores.isPending) return <p className="text-ink-muted">{tOps("loading")}</p>;
  if (stores.isError) return <FormError message={stores.error.message} />;
  return (
    <ul className="flex flex-col gap-3" data-testid="ops-stores">
      {stores.data.map((store) => (
        <StoreRow key={store.id} store={store} isAdmin={isAdmin} />
      ))}
    </ul>
  );
}

function StoreRow({
  store,
  isAdmin,
}: {
  readonly store: Wire<OpsMerchant>;
  readonly isAdmin: boolean;
}): JSX.Element {
  const t = useTranslations("Ops.stores");
  const tOps = useTranslations("Ops");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [rate, setRate] = useState(String(store.commissionBps / 100));
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const date = (iso: string): string =>
    new Intl.DateTimeFormat(locale === "fil" ? "fil-PH" : "en-PH", {
      timeZone: "Asia/Manila",
      dateStyle: "medium",
    }).format(new Date(iso));

  const post = async (path: string, body: unknown): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await requestJson<unknown>("POST", path, body, tOps("failed"));
    setBusy(false);
    if (!result.ok) setError(result.message);
    void queryClient.invalidateQueries({ queryKey: ["ops-stores"] });
  };
  const field = "border-border min-h-tap rounded-lg border px-3 font-normal";

  return (
    <li className="border-border flex flex-col gap-3 rounded-xl border p-4" data-store={store.name}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-ink flex-1 font-bold">{store.name}</p>
        <span
          className="bg-surface-muted text-ink rounded-full px-2 py-1 text-xs font-semibold"
          data-status={store.status}
        >
          {t(`status.${store.status}`)}
        </span>
      </div>
      <p className="text-ink-muted text-sm">
        {t("commission", { rate: store.commissionBps / 100 })}
        {store.nextCommissionBps !== null && store.nextCommissionFrom
          ? ` · ${t("next", { rate: store.nextCommissionBps / 100, date: date(store.nextCommissionFrom) })}`
          : ""}
        {store.foundingCommissionUntil
          ? ` · ${t("founding", { date: date(store.foundingCommissionUntil) })}`
          : ""}
      </p>
      {store.statusReason ? <p className="text-ink text-sm">{store.statusReason}</p> : null}
      {isAdmin && store.status !== "pending" ? (
        <>
          <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
            {tOps("reason")}
            <input
              className={field}
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-end gap-2">
            {store.status === "active" ? (
              <Button
                variant="secondary"
                disabled={busy || reason.trim().length < 3}
                onClick={() =>
                  void post(`/api/admin/stores/${store.id}/status`, { status: "suspended", reason })
                }
              >
                {t("suspend")}
              </Button>
            ) : (
              <Button
                disabled={busy}
                onClick={() =>
                  void post(`/api/admin/stores/${store.id}/status`, { status: "active" })
                }
              >
                {t("reactivate")}
              </Button>
            )}
            <label className="text-ink flex flex-col gap-1 text-xs font-semibold">
              {t("newRate")}
              <input
                className={`${field} w-24`}
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </label>
            <label className="text-ink flex flex-col gap-1 text-xs font-semibold">
              {t("from")}
              <input
                className={field}
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <Button
              variant="secondary"
              disabled={busy || !from || reason.trim().length < 3}
              onClick={() =>
                void post(`/api/admin/stores/${store.id}/commission`, {
                  commissionBps: Math.round(Number(rate) * 100),
                  effectiveFrom: `${from}T00:00:00+08:00`,
                  reason,
                })
              }
            >
              {t("schedule")}
            </Button>
          </div>
        </>
      ) : null}
      {error ? <FormError message={error} /> : null}
    </li>
  );
}
