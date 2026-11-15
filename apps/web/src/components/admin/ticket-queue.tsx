"use client";

import type { SupportTicket } from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { fetchData, postJson } from "@/lib/post-json";
import type { Wire } from "./wire";

const TABS = ["open", "resolved"] as const;

/** Low ratings for the coordinator to follow up, oldest first; resolving needs a note. */
export function TicketQueue(): JSX.Element {
  const t = useTranslations("Retention.tickets");
  const [tab, setTab] = useState<(typeof TABS)[number]>("open");
  const list = useQuery({
    queryKey: ["tickets", tab],
    queryFn: () =>
      fetchData<Wire<SupportTicket>[]>(`/api/admin/tickets?status=${tab}`, t("failed")),
  });
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label={t("title")} className="flex gap-2">
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
      {list.isPending ? <p className="text-ink-muted">{t("loading")}</p> : null}
      {list.isError ? <FormError message={list.error.message} /> : null}
      {list.data?.length === 0 ? <p className="text-ink-muted">{t("empty")}</p> : null}
      <ul className="flex flex-col gap-3" data-testid="ticket-queue">
        {list.data?.map((ticket) => (
          <TicketCard key={ticket.id} ticket={ticket} />
        ))}
      </ul>
    </div>
  );
}

function TicketCard({ ticket }: { readonly ticket: Wire<SupportTicket> }): JSX.Element {
  const t = useTranslations("Retention.tickets");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const when = new Intl.DateTimeFormat(locale === "fil" ? "fil-PH" : "en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ticket.createdAt));

  const resolve = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await postJson<unknown>(
      `/api/admin/tickets/${ticket.id}/resolve`,
      { resolution: note },
      t("failed"),
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["tickets"] });
  };

  return (
    <li
      className="border-border flex flex-col gap-2 rounded-xl border p-4"
      data-ticket={ticket.orderCode}
    >
      <p className="text-ink font-semibold">{ticket.summary}</p>
      <p className="text-ink-muted text-sm">
        {when} ·{" "}
        <Link href={`/admin/orders/${ticket.orderId}`} className="text-brand-800 underline">
          {ticket.orderCode}
        </Link>
      </p>
      {ticket.comment ? (
        <p className="text-ink bg-surface-muted rounded-lg p-2 text-sm">“{ticket.comment}”</p>
      ) : null}
      {ticket.status === "resolved" ? (
        <p className="text-ink text-sm">{t("resolvedWith", { note: ticket.resolution ?? "" })}</p>
      ) : (
        <>
          <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
            {t("noteLabel")}
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={300}
              className="border-border min-h-tap rounded-lg border px-3 font-normal"
            />
          </label>
          {error ? <FormError message={error} /> : null}
          <Button disabled={busy || note.trim().length < 3} onClick={() => void resolve()}>
            {t("resolve")}
          </Button>
        </>
      )}
    </li>
  );
}
