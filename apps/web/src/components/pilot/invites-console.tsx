"use client";

import type { InviteSummary } from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { TextField } from "@/components/auth/text-field";
import type { Wire } from "@/components/admin/wire";
import { fetchData, postJson } from "@/lib/post-json";

/** Create code batches, text the waitlist, and see which codes were used (admins). */
export function InvitesConsole(): JSX.Element {
  const t = useTranslations("Pilot.invites");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const summary = useQuery({
    queryKey: ["pilot-invites"],
    queryFn: () => fetchData<Wire<InviteSummary>>("/api/admin/pilot-invites", t("failed")),
  });
  const [batch, setBatch] = useState("");
  const [count, setCount] = useState("20");
  const [expires, setExpires] = useState("");
  const [waitCount, setWaitCount] = useState("10");
  const [created, setCreated] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["pilot-invites"] });
  const days = expires.trim() ? { expiresInDays: Number(expires) } : {};

  const createBatch = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await postJson<{ codes: string[] }>(
      "/api/admin/pilot-invites",
      { batch, count: Number(count), ...days },
      t("failed"),
    );
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setCreated(result.data.codes);
    refresh();
  };

  const inviteWaitlist = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await postJson<{ invited: number; notSent: number }>(
      "/api/admin/pilot-invites/waitlist",
      { count: Number(waitCount), ...days },
      t("failed"),
    );
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setNotice(t("invited", result.data));
    refresh();
  };

  const date = new Intl.DateTimeFormat(locale === "fil" ? "fil-PH" : "en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="flex flex-col gap-6">
      {error ? <FormError message={error} /> : null}
      {summary.data ? (
        <p className="text-ink font-semibold" data-testid="invite-usage">
          {t("usage", { redeemed: summary.data.redeemed, total: summary.data.total })}
        </p>
      ) : null}

      <section aria-labelledby="invites-batch-heading" className="flex flex-col gap-2">
        <h2 id="invites-batch-heading" className="text-ink text-lg font-bold">
          {t("batchTitle")}
        </h2>
        <form onSubmit={(e) => void createBatch(e)} className="grid gap-2 sm:grid-cols-3">
          <TextField
            label={t("batch")}
            name="batch"
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
          />
          <TextField
            label={t("count")}
            name="count"
            inputMode="numeric"
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
          <TextField
            label={t("expires")}
            name="expires"
            inputMode="numeric"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
          />
          <Button
            type="submit"
            disabled={busy || !batch.trim()}
            className="sm:col-span-3 sm:justify-self-start"
          >
            {t("create")}
          </Button>
        </form>
        {created.length > 0 ? (
          <div className="bg-surface-muted rounded-lg p-3" data-testid="new-codes">
            <p className="text-ink font-semibold">{t("created")}</p>
            <p className="text-ink font-mono text-sm break-words">{created.join("  ")}</p>
            <Button
              variant="ghost"
              onClick={() => void navigator.clipboard.writeText(created.join("\n"))}
            >
              {t("copy")}
            </Button>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="invites-waitlist-heading" className="flex flex-col gap-2">
        <h2 id="invites-waitlist-heading" className="text-ink text-lg font-bold">
          {t("waitlistTitle")}
        </h2>
        <p className="text-ink-muted text-sm">{t("waitlistLead")}</p>
        <form onSubmit={(e) => void inviteWaitlist(e)} className="flex flex-wrap items-end gap-2">
          <TextField
            label={t("waitlistCount")}
            name="waitCount"
            inputMode="numeric"
            value={waitCount}
            onChange={(e) => setWaitCount(e.target.value)}
          />
          <Button type="submit" disabled={busy}>
            {t("invite")}
          </Button>
        </form>
        {notice ? (
          <p role="status" className="text-ink text-sm">
            {notice}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="invites-codes-heading" className="flex flex-col gap-2">
        <h2 id="invites-codes-heading" className="text-ink text-lg font-bold">
          {t("listTitle")}
        </h2>
        {summary.isPending ? <p className="text-ink-muted">{t("loading")}</p> : null}
        {summary.isError ? <FormError message={summary.error.message} /> : null}
        {summary.data && summary.data.invites.length === 0 ? (
          <p className="text-ink-muted">{t("empty")}</p>
        ) : null}
        <ul className="flex flex-col gap-1">
          {summary.data?.invites.map((invite) => {
            const expired = invite.expiresAt !== null && new Date(invite.expiresAt) < new Date();
            const status = invite.redeemedAt
              ? t("statusUsed", { date: date.format(new Date(invite.redeemedAt)) })
              : expired
                ? t("statusExpired")
                : invite.sentAt
                  ? t("statusSent", { date: date.format(new Date(invite.sentAt)) })
                  : t("statusOpen");
            return (
              <li key={invite.code} className="text-ink text-sm">
                <span className="font-mono font-semibold">{invite.code}</span> · {invite.batch} ·{" "}
                {status}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
