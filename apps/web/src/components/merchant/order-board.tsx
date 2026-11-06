"use client";

import { formatPeso, type BoardOrder } from "@klikgo/core";
import { PREP_TIME_CHIPS, REJECT_REASONS } from "@klikgo/types";
import { Button } from "@klikgo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Volume2, VolumeX } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { PushOptIn } from "@/components/push-opt-in";
import { OrderAlarm } from "@/lib/order-alarm";
import { fetchData, requestJson } from "@/lib/post-json";
import { useLiveTopic } from "@/lib/realtime";

/** JSON turns the board's dates into strings. */
type Wire<T> = {
  [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K];
};
type Card = Wire<BoardOrder> & { confirmBy?: string; readyBy?: string | null };
interface Board {
  new: Card[];
  preparing: Card[];
  ready: Card[];
  pickedUp: Card[];
}

/** A clock that ticks every second (countdowns). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The store's order board (docs/BUSINESS.md §9.2.2): new orders ring until someone accepts or
 * rejects them, with the 3-minute confirm countdown; preparing orders show when they should be
 * ready. Live over the store's private Realtime channel, with polling as a safety net.
 */
export function OrderBoard({
  merchantId,
  storeName,
}: {
  readonly merchantId: string;
  readonly storeName: string;
}): JSX.Element {
  const t = useTranslations("Merchant.orders");
  const queryClient = useQueryClient();
  const queryKey = ["merchant-board", merchantId];
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["merchant-board", merchantId] });
  }, [queryClient, merchantId]);
  const live = useLiveTopic(`merchant:${merchantId}`, refresh);
  const board = useQuery({
    queryKey,
    queryFn: () => fetchData<Board>(`/api/merchant/${merchantId}/orders`, t("failed")),
    refetchInterval: live === "live" ? 20_000 : 5000,
  });
  const alarm = useRef<OrderAlarm | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const newCount = board.data?.new.length ?? 0;

  useEffect(() => {
    alarm.current ??= new OrderAlarm();
    if (soundOn && newCount > 0) alarm.current.start();
    else alarm.current.stop();
  }, [soundOn, newCount]);
  useEffect(() => () => alarm.current?.stop(), []);
  useEffect(() => {
    document.title = newCount > 0 ? `(${String(newCount)}) ${t("title")}` : t("title");
  }, [newCount, t]);

  const toggleSound = (): void => {
    alarm.current ??= new OrderAlarm();
    // Browsers only allow sound after a tap, so this button unlocks it.
    if (!soundOn) alarm.current.unlock();
    setSoundOn(!soundOn);
  };

  if (board.isPending) return <p className="text-ink-muted">{t("loading")}</p>;
  if (board.isError) return <FormError message={board.error.message} />;
  const data = board.data;

  const columns: { key: keyof Board; title: string; empty: string }[] = [
    { key: "new", title: t("column.new"), empty: t("empty.new") },
    { key: "preparing", title: t("column.preparing"), empty: t("empty.preparing") },
    { key: "ready", title: t("column.ready"), empty: t("empty.ready") },
    { key: "pickedUp", title: t("column.pickedUp"), empty: t("empty.pickedUp") },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-ink-muted text-sm">{storeName}</p>
          <h1 className="text-ink text-2xl font-bold">{t("title")}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2 py-1 text-xs font-semibold ${live === "live" ? "bg-brand-50 text-brand-800" : "bg-surface-muted text-ink-muted"}`}
            data-testid="live-state"
          >
            {live === "live" ? t("live") : t("polling")}
          </span>
          <Button
            variant={soundOn ? "secondary" : "primary"}
            onClick={toggleSound}
            aria-pressed={soundOn}
          >
            {soundOn ? (
              <Volume2 aria-hidden className="size-5" />
            ) : (
              <VolumeX aria-hidden className="size-5" />
            )}
            {soundOn ? t("soundOn") : t("soundOff")}
          </Button>
          <PushOptIn />
        </div>
      </div>
      {!soundOn && newCount > 0 ? (
        <p
          className="bg-accent-400 text-ink flex items-center gap-2 rounded-xl p-3 font-semibold"
          role="alert"
        >
          <BellRing aria-hidden className="size-5" />
          {t("turnOnSound")}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-4">
        {columns.map((column) => (
          <section
            key={column.key}
            aria-labelledby={`column-${column.key}`}
            className="flex flex-col gap-3"
          >
            <h2 id={`column-${column.key}`} className="text-ink text-lg font-bold">
              {column.title} <span className="text-ink-muted">({data[column.key].length})</span>
            </h2>
            {data[column.key].length === 0 ? (
              <p className="text-ink-muted text-sm">{column.empty}</p>
            ) : (
              data[column.key].map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  merchantId={merchantId}
                  onChanged={refresh}
                />
              ))
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function OrderCard({
  order,
  merchantId,
  onChanged,
}: {
  readonly order: Card;
  readonly merchantId: string;
  readonly onChanged: () => void;
}): JSX.Element {
  const t = useTranslations("Merchant.orders");
  const tMethod = useTranslations("Customer.checkout.method");
  const locale = useLocale();
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [otherReason, setOtherReason] = useState("");
  const [soldOut, setSoldOut] = useState<Set<string>>(() => new Set());
  const time = new Intl.DateTimeFormat(locale === "fil" ? "fil-PH" : "en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  });

  const act = async (path: string, body: unknown): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await requestJson<unknown>(
      "POST",
      `/api/orders/${order.id}/${path}`,
      body,
      t("failed"),
    );
    setBusy(false);
    if (!result.ok) setError(result.message);
    else setRejecting(false);
    onChanged();
  };

  const markSoldOut = async (itemId: string): Promise<void> => {
    const result = await requestJson<unknown>(
      "PUT",
      `/api/merchant/${merchantId}/menu/items/${itemId}/availability`,
      { isAvailable: false },
      t("failed"),
    );
    if (result.ok) setSoldOut(new Set([...soldOut, itemId]));
    else setError(result.message);
  };

  const secondsLeft = order.confirmBy
    ? Math.max(0, Math.round((Date.parse(order.confirmBy) - now) / 1000))
    : null;
  const countdown =
    secondsLeft === null
      ? null
      : `${String(Math.floor(secondsLeft / 60))}:${String(secondsLeft % 60).padStart(2, "0")}`;
  const isNew = order.status === "placed";

  return (
    <article
      className={`flex flex-col gap-3 rounded-2xl border-2 p-4 ${isNew ? "border-brand-600 bg-white" : "border-surface-muted bg-white"}`}
      aria-label={t("orderLabel", { code: order.code })}
      data-testid="board-order"
      data-code={order.code}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-ink text-lg font-bold">{order.code}</h3>
        <span className="text-ink-muted text-sm">{time.format(new Date(order.placedAt))}</span>
      </div>
      {order.scheduledFor ? (
        <p className="text-ink text-sm font-semibold">
          {t("scheduled", { time: time.format(new Date(order.scheduledFor)) })}
        </p>
      ) : null}
      {isNew && countdown ? (
        <p
          className={`text-sm font-bold ${secondsLeft !== null && secondsLeft < 60 ? "text-danger-900" : "text-ink"}`}
          data-testid="confirm-countdown"
        >
          {t("confirmWithin", { time: countdown })}
        </p>
      ) : null}
      {order.readyBy ? (
        <p className="text-ink text-sm">
          {t("readyBy", { time: time.format(new Date(order.readyBy)) })}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1">
        {order.items.map((item, index) => (
          <li
            key={`${item.name}-${String(index)}`}
            className="flex items-start justify-between gap-2"
          >
            <span className="text-ink">
              <strong>{item.quantity}×</strong> {item.name}
              {item.modifiers.length > 0 ? (
                <span className="text-ink-muted block text-sm">{item.modifiers.join(", ")}</span>
              ) : null}
            </span>
            {isNew && item.menuItemId ? (
              <Button
                variant="ghost"
                className="h-auto min-h-0 px-2 py-1 text-xs"
                disabled={soldOut.has(item.menuItemId)}
                onClick={() => void markSoldOut(item.menuItemId ?? "")}
              >
                {soldOut.has(item.menuItemId) ? t("markedSoldOut") : t("soldOut")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {order.notes ? (
        <p className="bg-surface-muted text-ink rounded-lg p-2 text-sm">{order.notes}</p>
      ) : null}
      <p className="text-ink text-sm">
        {formatPeso(order.totalCentavos)} · {tMethod(order.paymentMethod)}
        {order.paymentMethod === "cod" ? ` · ${t("collectCash")}` : ` · ${t("paid")}`}
      </p>

      {isNew && !rejecting ? (
        <div className="flex flex-col gap-2">
          <p className="text-ink text-sm font-semibold">{t("acceptWith")}</p>
          <div className="grid grid-cols-4 gap-2">
            {PREP_TIME_CHIPS.map((minutes) => (
              <Button
                key={minutes}
                className="px-2"
                disabled={busy}
                aria-label={t("acceptMinutes", { minutes })}
                onClick={() => void act("accept", { prepMinutes: minutes })}
              >
                {t("minutes", { minutes })}
              </Button>
            ))}
          </div>
          <Button variant="ghost" disabled={busy} onClick={() => setRejecting(true)}>
            {t("reject")}
          </Button>
        </div>
      ) : null}
      {isNew && rejecting ? (
        <div className="flex flex-col gap-2" role="group" aria-label={t("rejectWhy")}>
          <p className="text-ink text-sm font-semibold">{t("rejectWhy")}</p>
          {REJECT_REASONS.map((reason) => (
            <Button
              key={reason}
              variant="secondary"
              disabled={busy}
              onClick={() => void act("reject", { reason })}
            >
              {t(`rejectReason.${REJECT_REASONS.indexOf(reason)}`)}
            </Button>
          ))}
          <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
            {t("otherReason")}
            <input
              className="border-ink-muted/40 text-ink min-h-tap rounded-xl border-2 px-3 text-base"
              value={otherReason}
              maxLength={300}
              onChange={(event) => setOtherReason(event.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <Button
              disabled={busy || otherReason.trim().length < 3}
              onClick={() => void act("reject", { reason: otherReason.trim() })}
            >
              {t("rejectConfirm")}
            </Button>
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              {t("keep")}
            </Button>
          </div>
        </div>
      ) : null}
      {order.status === "accepted" || order.status === "preparing" ? (
        <Button disabled={busy} onClick={() => void act("ready", {})}>
          {t("markReady")}
        </Button>
      ) : null}
      {order.status === "ready" ? (
        <p className="text-ink-muted text-sm">{t("waitingRider")}</p>
      ) : null}
      {error ? <FormError message={error} /> : null}
    </article>
  );
}
