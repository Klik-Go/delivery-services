"use client";

import type { RiderReview } from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { fetchData, requestJson } from "@/lib/post-json";
import type { Wire } from "./wire";

const TABS = ["pending", "active", "suspended", "coaching"] as const;
type Tab = (typeof TABS)[number];

/**
 * Rider onboarding and status (docs/BUSINESS.md Appendix B, §5.3): the KYC queue with each
 * document's state, 60-second links to view them, accept/reject with a reason, approve, suspend.
 */
export function RiderReviewQueue(): JSX.Element {
  const t = useTranslations("Ops.riders");
  const tOps = useTranslations("Ops");
  const [tab, setTab] = useState<Tab>("pending");
  const list = useQuery({
    queryKey: ["ops-riders", tab],
    queryFn: () =>
      fetchData<Wire<RiderReview>[]>(`/api/admin/riders?filter=${tab}`, tOps("failed")),
  });
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label={t("title")} className="flex flex-wrap gap-2">
        {TABS.map((key) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`min-h-tap rounded-full px-4 text-sm font-semibold ${tab === key ? "bg-brand-800 text-white" : "bg-surface-muted text-ink"}`}
          >
            {t(`tabs.${key}`)}
          </button>
        ))}
      </div>
      <p className="text-ink-muted text-sm">{t("linkNote")}</p>
      {list.isPending ? <p className="text-ink-muted">{tOps("loading")}</p> : null}
      {list.isError ? <FormError message={list.error.message} /> : null}
      {list.data?.length === 0 ? <p className="text-ink-muted">{t("empty")}</p> : null}
      <ul className="flex flex-col gap-4" data-testid="rider-queue">
        {list.data?.map((rider) => (
          <RiderCard key={rider.id} rider={rider} />
        ))}
      </ul>
    </div>
  );
}

function RiderCard({ rider }: { readonly rider: Wire<RiderReview> }): JSX.Element {
  const t = useTranslations("Ops.riders");
  const tOps = useTranslations("Ops");
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

  const run = async (method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> => {
    setBusy(true);
    setError(null);
    const result = await requestJson<unknown>(method, path, body, tOps("failed"));
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return null;
    }
    void queryClient.invalidateQueries({ queryKey: ["ops-riders"] });
    return result.data;
  };

  const view = async (documentId: string): Promise<void> => {
    const link = (await run("GET", `/api/admin/kyc/${documentId}`)) as { url: string } | null;
    if (link) window.open(link.url, "_blank", "noopener,noreferrer");
  };

  return (
    <li
      className="border-border flex flex-col gap-3 rounded-xl border p-4"
      data-rider={rider.name ?? rider.id}
    >
      <div>
        <p className="text-ink text-lg font-bold">{rider.name ?? rider.id}</p>
        <p className="text-ink-muted text-sm">
          {t("vehicle", { vehicle: rider.vehicleType, plate: rider.plateNo ?? "—" })}
          {rider.phone ? ` · ${rider.phone}` : ""}
        </p>
        {rider.payoutAccountName ? (
          <p className="text-ink-muted text-sm">
            {t("payoutName", { name: rider.payoutAccountName })}
          </p>
        ) : null}
        {rider.ratingCount > 0 ? (
          <p className="text-ink-muted text-sm">
            {t("rating", { rating: rider.ratingAvg.toFixed(1), count: rider.ratingCount })}
          </p>
        ) : null}
        {rider.statusReason ? <p className="text-ink text-sm">{rider.statusReason}</p> : null}
      </div>
      {rider.status === "pending_kyc" ? (
        <ul className="flex flex-col gap-2">
          {rider.checklist.map((item) => (
            <li
              key={item.type}
              className="bg-surface-muted flex flex-col gap-2 rounded-lg p-2 sm:flex-row sm:items-center"
              data-doc={item.type}
            >
              <div className="flex flex-1 items-center justify-between gap-2">
                <span className="text-ink text-sm font-semibold">{t(`doc.${item.type}`)}</span>
                <span className="text-ink-muted text-xs" data-state={item.state}>
                  {t(`state.${item.state}`)}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {item.document ? (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void view(item.document?.id ?? "")}
                  >
                    {t("view")}
                  </Button>
                ) : null}
                {item.document && item.state === "pending" ? (
                  <>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run("POST", `/api/admin/kyc/${item.document?.id ?? ""}`, {
                          decision: "approve",
                        })
                      }
                    >
                      {t("accept")}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy || reason.trim().length < 3}
                      onClick={() =>
                        void run("POST", `/api/admin/kyc/${item.document?.id ?? ""}`, {
                          decision: "reject",
                          reason,
                        })
                      }
                    >
                      {t("reject")}
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
        {rider.status === "pending_kyc" ? t("rejectReason") : t("suspendReason")}
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={300}
          className="border-border min-h-tap rounded-lg border px-3 font-normal"
        />
      </label>
      {error ? <FormError message={error} /> : null}
      <div className="flex flex-wrap gap-2">
        {rider.status === "pending_kyc" ? (
          <Button
            disabled={busy}
            onClick={() =>
              void run("POST", `/api/admin/riders/${rider.id}/status`, { status: "active" })
            }
          >
            {t("approve")}
          </Button>
        ) : null}
        {rider.status === "active" ? (
          <Button
            variant="secondary"
            disabled={busy || reason.trim().length < 3}
            onClick={() =>
              void run("POST", `/api/admin/riders/${rider.id}/status`, {
                status: "suspended",
                reason,
              })
            }
          >
            {t("suspend")}
          </Button>
        ) : null}
        {rider.status === "suspended" ? (
          <Button
            disabled={busy}
            onClick={() =>
              void run("POST", `/api/admin/riders/${rider.id}/status`, { status: "active" })
            }
          >
            {t("reactivate")}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
