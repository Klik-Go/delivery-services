"use client";

import { formatPeso, type LiveMap, type OpsOrderDetail, type Sla } from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useState, type FormEvent, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { fetchData, requestJson } from "@/lib/post-json";
import { useLiveTopic } from "@/lib/realtime";
import { SlaBadge } from "./sla-badge";
import { manilaTime, type Wire } from "./wire";

type Detail = Wire<OpsOrderDetail & { readonly sla: Sla | null }>;

const ASSIGNABLE = new Set(["accepted", "preparing", "ready"]);
const CANCELLABLE = new Set(["placed", "accepted", "preparing", "ready"]);

/** One order for the zone's coordinator: its story, notes and the hands-on actions. */
export function OrderDetail({ orderId }: { readonly orderId: string }): JSX.Element {
  const t = useTranslations("Ops.order");
  const tOps = useTranslations("Ops");
  const tStatus = useTranslations("Customer.order.status");
  const tPay = useTranslations("Customer.order.paymentStatus");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["ops-order", orderId] });
  }, [queryClient, orderId]);
  const live = useLiveTopic(`order:${orderId}`, refresh);
  const order = useQuery({
    queryKey: ["ops-order", orderId],
    queryFn: () => fetchData<Detail>(`/api/admin/orders/${orderId}`, tOps("failed")),
    refetchInterval: live === "live" ? 30_000 : 8000,
  });

  if (order.isPending) return <p className="text-ink-muted">{tOps("loading")}</p>;
  if (order.isError) return <FormError message={order.error.message} />;
  const o = order.data;
  const live_ = CANCELLABLE.has(o.status);

  return (
    <div className="flex flex-col gap-5" data-testid="ops-order">
      <Link href="/admin" className="text-brand-800 self-start font-semibold underline">
        {t("back")}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-ink text-2xl font-bold">{t("title", { code: o.code })}</h2>
        {o.sla ? <SlaBadge state={o.sla.state} /> : null}
      </div>
      <dl className="bg-surface-muted grid grid-cols-2 gap-2 rounded-xl p-4 text-sm">
        <dt className="text-ink-muted">{t("status")}</dt>
        <dd className="text-ink font-semibold" data-testid="ops-order-status">
          {tStatus(o.status)}
        </dd>
        <dt className="text-ink-muted">{t("store")}</dt>
        <dd className="text-ink">{o.merchantName}</dd>
        <dt className="text-ink-muted">{t("payment")}</dt>
        <dd className="text-ink">
          {o.paymentMethod.toUpperCase()} · {tPay(o.paymentStatus)}
        </dd>
        <dt className="text-ink-muted">{t("total")}</dt>
        <dd className="text-ink">{formatPeso(o.totalCentavos)}</dd>
      </dl>

      <section aria-labelledby="history-heading" className="flex flex-col gap-2">
        <h3 id="history-heading" className="text-ink text-lg font-bold">
          {t("history")}
        </h3>
        <ol className="flex flex-col gap-1" data-testid="ops-history">
          {o.history.map((entry) => (
            <li key={`${entry.at}-${entry.to}`} className="text-ink text-sm">
              <span className="text-ink-muted">{manilaTime(entry.at, locale)}</span> ·{" "}
              {tStatus(entry.to)}{" "}
              <span className="text-ink-muted">
                {t("by", {
                  role: entry.actorRole ? entry.actorRole.replace("_", " ") : t("system"),
                })}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {!live_ ? <p className="text-ink-muted">{t("ended")}</p> : null}
      {ASSIGNABLE.has(o.status) ? (
        <AssignRider
          orderId={orderId}
          zoneId={o.zoneId}
          currentRiderId={o.riderId}
          onDone={refresh}
        />
      ) : null}
      {live_ ? <CancelOrder orderId={orderId} onDone={refresh} /> : null}
      <RefundOrder
        orderId={orderId}
        paidOnline={o.paymentMethod !== "cod" && o.paymentStatus !== "pending"}
        onDone={refresh}
      />
      <Notes orderId={orderId} notes={o.notes} locale={locale} onDone={refresh} />
    </div>
  );
}

function useAction(onDone: () => void): {
  busy: boolean;
  error: string | null;
  run: (method: "POST", path: string, body: unknown) => Promise<boolean>;
} {
  const tOps = useTranslations("Ops");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (method: "POST", path: string, body: unknown): Promise<boolean> => {
    setBusy(true);
    setError(null);
    const result = await requestJson<unknown>(method, path, body, tOps("failed"));
    setBusy(false);
    if (!result.ok) setError(result.message);
    onDone();
    return result.ok;
  };
  return { busy, error, run };
}

function ReasonField({
  id,
  value,
  onChange,
}: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
}): JSX.Element {
  const tOps = useTranslations("Ops");
  return (
    <label htmlFor={id} className="text-ink flex flex-col gap-1 text-sm font-semibold">
      {tOps("reason")}
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={300}
        className="border-border min-h-tap rounded-lg border px-3 font-normal"
      />
    </label>
  );
}

function AssignRider({
  orderId,
  zoneId,
  currentRiderId,
  onDone,
}: {
  readonly orderId: string;
  readonly zoneId: string;
  readonly currentRiderId: string | null;
  readonly onDone: () => void;
}): JSX.Element {
  const t = useTranslations("Ops.order");
  const tOps = useTranslations("Ops");
  const riders = useQuery({
    queryKey: ["ops-live", "riders"],
    queryFn: () => fetchData<Wire<LiveMap>>("/api/admin/live", tOps("failed")),
  });
  const [riderId, setRiderId] = useState("");
  const [reason, setReason] = useState("");
  const action = useAction(onDone);
  const choices = (riders.data?.riders ?? []).filter(
    (r) => r.zoneId === zoneId && r.status === "active" && r.id !== currentRiderId,
  );
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (await action.run("POST", `/api/admin/orders/${orderId}/assign`, { riderId, reason })) {
      setReason("");
      setRiderId("");
    }
  };
  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="border-border flex flex-col gap-3 rounded-xl border p-4"
      aria-labelledby="assign-heading"
    >
      <h3 id="assign-heading" className="text-ink text-lg font-bold">
        {currentRiderId ? t("reassign") : t("assign")}
      </h3>
      <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
        {t("chooseRider")}
        <select
          value={riderId}
          onChange={(event) => setRiderId(event.target.value)}
          className="border-border bg-surface min-h-tap rounded-lg border px-3 font-normal"
        >
          <option value="">—</option>
          {choices.map((r) => (
            <option key={r.id} value={r.id}>
              {t("riderOption", {
                name: r.name ?? r.id.slice(0, 8),
                state: r.activeOrderId ? t("busy") : r.isOnline ? t("online") : t("offline"),
              })}
            </option>
          ))}
        </select>
      </label>
      <ReasonField id="assign-reason" value={reason} onChange={setReason} />
      {action.error ? <FormError message={action.error} /> : null}
      <Button type="submit" disabled={action.busy || !riderId}>
        {t("assignButton")}
      </Button>
    </form>
  );
}

function CancelOrder({
  orderId,
  onDone,
}: {
  readonly orderId: string;
  readonly onDone: () => void;
}): JSX.Element {
  const t = useTranslations("Ops.order");
  const [reason, setReason] = useState("");
  const action = useAction(onDone);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void action.run("POST", `/api/admin/orders/${orderId}/cancel`, { reason });
      }}
      className="border-border flex flex-col gap-3 rounded-xl border p-4"
      aria-labelledby="cancel-heading"
    >
      <h3 id="cancel-heading" className="text-ink text-lg font-bold">
        {t("cancelOrder")}
      </h3>
      <ReasonField id="cancel-reason" value={reason} onChange={setReason} />
      {action.error ? <FormError message={action.error} /> : null}
      <Button type="submit" variant="secondary" disabled={action.busy}>
        {t("cancelButton")}
      </Button>
    </form>
  );
}

function RefundOrder({
  orderId,
  paidOnline,
  onDone,
}: {
  readonly orderId: string;
  readonly paidOnline: boolean;
  readonly onDone: () => void;
}): JSX.Element {
  const t = useTranslations("Ops.order");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const action = useAction(onDone);
  if (!paidOnline) return <p className="text-ink-muted text-sm">{t("codNoRefund")}</p>;
  const centavos = amount.trim() === "" ? undefined : Math.round(Number(amount) * 100);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void action.run("POST", `/api/admin/orders/${orderId}/refunds`, {
          reason,
          ...(centavos === undefined ? {} : { amountCentavos: centavos }),
        });
      }}
      className="border-border flex flex-col gap-3 rounded-xl border p-4"
      aria-labelledby="refund-heading"
    >
      <h3 id="refund-heading" className="text-ink text-lg font-bold">
        {t("refund")}
      </h3>
      <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
        {t("refundAmount")}
        <input
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
          className="border-border min-h-tap rounded-lg border px-3 font-normal"
        />
      </label>
      <ReasonField id="refund-reason" value={reason} onChange={setReason} />
      {action.error ? <FormError message={action.error} /> : null}
      <Button type="submit" variant="secondary" disabled={action.busy}>
        {t("refundButton")}
      </Button>
    </form>
  );
}

function Notes({
  orderId,
  notes,
  locale,
  onDone,
}: {
  readonly orderId: string;
  readonly notes: Detail["notes"];
  readonly locale: string;
  readonly onDone: () => void;
}): JSX.Element {
  const t = useTranslations("Ops.order");
  const [body, setBody] = useState("");
  const action = useAction(onDone);
  return (
    <section aria-labelledby="notes-heading" className="flex flex-col gap-3">
      <h3 id="notes-heading" className="text-ink text-lg font-bold">
        {t("notes")}
      </h3>
      {notes.length === 0 ? <p className="text-ink-muted text-sm">{t("noNotes")}</p> : null}
      <ul className="flex flex-col gap-2" data-testid="ops-notes">
        {notes.map((note) => (
          <li key={note.id} className="bg-surface-muted rounded-lg p-3 text-sm">
            <p className="text-ink">{note.body}</p>
            <p className="text-ink-muted">
              {note.authorName ?? note.authorRole} · {manilaTime(note.at, locale)}
            </p>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void action.run("POST", `/api/admin/orders/${orderId}/notes`, { body }).then((ok) => {
            if (ok) setBody("");
          });
        }}
        className="flex flex-col gap-2"
      >
        <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
          {t("note")}
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={1000}
            rows={2}
            className="border-border rounded-lg border px-3 py-2 font-normal"
          />
        </label>
        {action.error ? <FormError message={action.error} /> : null}
        <Button type="submit" variant="secondary" disabled={action.busy || body.trim() === ""}>
          {t("addNote")}
        </Button>
      </form>
    </section>
  );
}
