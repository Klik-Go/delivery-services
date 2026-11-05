"use client";

import { Button } from "@klikgo/ui";
import { useTranslations } from "next-intl";
import { useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { TextField } from "@/components/auth/text-field";
import { postJson } from "@/lib/post-json";

/** One partner application as the admin list shows it. */
export interface ApplicationCardData {
  readonly id: string;
  readonly businessName: string;
  readonly ownerName: string;
  readonly phone: string;
  readonly email: string;
  readonly barangay: string;
  readonly city: string;
  readonly zoneName: string | null;
  readonly receivedAt: string;
}

/** Approve (with commission and founding-partner terms) or reject one application. */
export function ApplicationReview({
  application,
}: {
  readonly application: ApplicationCardData;
}): JSX.Element {
  const t = useTranslations("AdminMerchants");
  const [percent, setPercent] = useState("20");
  const [founding, setFounding] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<
    { kind: "approved"; inviteUrl: string; slug: string } | { kind: "rejected" } | null
  >(null);
  const base = `/api/admin/merchant-applications/${application.id}`;

  async function approve(): Promise<void> {
    setBusy("approve");
    setError(null);
    const result = await postJson<{ inviteUrl: string; slug: string }>(
      `${base}/approve`,
      { commissionBps: Math.round(Number(percent) * 100), foundingPartner: founding },
      t("failed"),
    );
    setBusy(null);
    if (result.ok) setOutcome({ kind: "approved", ...result.data });
    else setError(result.message);
  }

  async function reject(): Promise<void> {
    setBusy("reject");
    setError(null);
    const result = await postJson(`${base}/reject`, { reason }, t("failed"));
    setBusy(null);
    if (result.ok) setOutcome({ kind: "rejected" });
    else setError(result.message);
  }

  const heading = `application-${application.id}`;
  return (
    <article
      aria-labelledby={heading}
      className="bg-surface-muted rounded-card flex flex-col gap-3 p-4"
    >
      <header className="flex flex-col gap-1">
        <h2 id={heading} className="text-ink text-xl font-bold">
          {application.businessName}
        </h2>
        <p className="text-ink-muted text-sm">
          {application.ownerName} · {application.phone} · {application.email}
        </p>
        <p className="text-ink-muted text-sm">
          {application.barangay}, {application.city} · {application.zoneName ?? t("outsideZones")} ·{" "}
          {application.receivedAt}
        </p>
      </header>
      {outcome?.kind === "approved" ? (
        <div aria-live="polite" className="flex flex-col gap-2">
          <p className="text-ink font-semibold">{t("approved")}</p>
          <code className="text-ink rounded-xl bg-white p-2 text-sm break-all">
            {outcome.inviteUrl}
          </code>
          <a className="text-brand-800 font-semibold underline" href={`/stores/${outcome.slug}`}>
            {t("storePage")}
          </a>
        </div>
      ) : outcome?.kind === "rejected" ? (
        <p aria-live="polite" className="text-ink font-semibold">
          {t("rejected")}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <TextField
              label={t("commission")}
              name={`commission-${application.id}`}
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={0.5}
              value={percent}
              onChange={(event) => setPercent(event.target.value)}
            />
            <label className="text-ink min-h-tap flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                className="accent-brand-800 size-5"
                checked={founding}
                onChange={(event) => setFounding(event.target.checked)}
              />
              {t("founding")}
            </label>
          </div>
          <Button
            onClick={() => void approve()}
            disabled={busy !== null || application.zoneName === null}
            className="self-start"
          >
            {busy === "approve" ? t("approving") : t("approve")}
          </Button>
          <div className="flex flex-wrap items-end gap-3">
            <TextField
              label={t("rejectReason")}
              name={`reason-${application.id}`}
              value={reason}
              maxLength={300}
              onChange={(event) => setReason(event.target.value)}
            />
            <Button
              variant="secondary"
              onClick={() => void reject()}
              disabled={busy !== null || reason.trim() === ""}
            >
              {busy === "reject" ? t("rejecting") : t("reject")}
            </Button>
          </div>
          <FormError message={error} />
        </>
      )}
    </article>
  );
}
