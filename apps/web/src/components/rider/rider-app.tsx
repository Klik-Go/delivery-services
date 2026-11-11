"use client";

import {
  formatPeso,
  type RiderEarnings,
  type RiderJobView,
  type RiderOffer,
  type RiderStatus,
} from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, MapPin, Navigation, Phone, Store } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { PushOptIn } from "@/components/push-opt-in";
import { compressToWebp } from "@/lib/compress-image";
import { fetchData, requestJson } from "@/lib/post-json";
import { useLiveTopic } from "@/lib/realtime";
import { googleMapsLink, secondsLeft, wazeLink } from "@/lib/rider-location";
import { SwipeConfirm } from "./swipe-confirm";
import { useLocationSharing, useWakeLock } from "./use-rider-device";

/** JSON turns dates into strings. */
type Wire<T> = {
  [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K];
};

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

const km = (metres: number): string => (metres / 1000).toFixed(1);

/**
 * The rider app (docs/BUSINESS.md §5.2 steps 4–6, §9.3): go online, keep the screen on and share
 * the position, answer 30-second offers that show the pay upfront, then work the job step by
 * step with Waze / Google Maps links, the cash to collect and the delivery PIN or photo. Live over
 * the rider's private channel, with polling as a safety net.
 */
export function RiderApp(): JSX.Element {
  const t = useTranslations("Rider");
  const queryClient = useQueryClient();
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["rider"] });
  }, [queryClient]);
  const me = useQuery({
    queryKey: ["rider", "me"],
    queryFn: () => fetchData<RiderStatus>("/api/rider/me", t("failed")),
  });
  const riderId = me.data?.rider.id ?? null;
  const online = me.data?.rider.isOnline ?? false;
  const live = useLiveTopic(riderId ? `rider:${riderId}` : null, refresh, ["offer", "status"]);
  const offer = useQuery({
    queryKey: ["rider", "offer"],
    queryFn: () => fetchData<Wire<RiderOffer> | null>("/api/rider/offers/current", t("failed")),
    enabled: online,
    refetchInterval: live === "live" ? 15_000 : 4000,
  });
  const job = useQuery({
    queryKey: ["rider", "job"],
    queryFn: () => fetchData<Wire<RiderJobView> | null>("/api/rider/job", t("failed")),
    enabled: me.isSuccess,
    refetchInterval: live === "live" ? 20_000 : 5000,
  });
  const earnings = useQuery({
    queryKey: ["rider", "earnings"],
    queryFn: () => fetchData<RiderEarnings>("/api/rider/earnings", t("failed")),
    enabled: me.isSuccess,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wake = useWakeLock(online);
  const gps = useLocationSharing(online, refresh);

  const call = async (path: string, body?: unknown): Promise<boolean> => {
    setBusy(true);
    setError(null);
    const result = await requestJson<unknown>("POST", path, body ?? {}, t("failed"));
    setBusy(false);
    if (!result.ok) setError(result.message);
    refresh();
    return result.ok;
  };

  if (me.isPending) return <p className="text-ink-muted">{t("loading")}</p>;
  if (me.isError) return <FormError message={me.error.message} />;
  const { rider } = me.data;
  const current = job.data ?? null;

  return (
    <div className="flex flex-col gap-4" data-testid="rider-app">
      <section className="bg-surface-muted flex flex-col gap-3 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-ink text-lg font-semibold" role="status" data-testid="rider-online">
            {online ? t("online") : t("offline")}
          </p>
          {live === "live" && online ? (
            <span className="bg-brand-50 text-brand-800 rounded-full px-2 py-1 text-xs font-semibold">
              {t("live")}
            </span>
          ) : null}
        </div>
        {rider.status !== "active" ? (
          <p className="text-ink">{t("pendingApproval")}</p>
        ) : (
          <Button
            size="lg"
            variant={online ? "secondary" : "primary"}
            disabled={busy || (online && current !== null)}
            onClick={() => void call("/api/rider/status", { online: !online })}
          >
            {online ? t("goOffline") : t("goOnline")}
          </Button>
        )}
        {online ? (
          <ul className="text-ink-muted flex flex-col gap-1 text-sm">
            <li>{t(`gps.${gps}`)}</li>
            <li>{t(`wake.${wake}`)}</li>
            <li>{t("keepOpen")}</li>
          </ul>
        ) : null}
        {online && current ? <p className="text-ink-muted text-sm">{t("finishFirst")}</p> : null}
      </section>
      {error ? <FormError message={error} /> : null}

      {current ? (
        <JobCard job={current} busy={busy} call={call} onError={setError} refresh={refresh} />
      ) : offer.data ? (
        <OfferCard
          offer={offer.data}
          busy={busy}
          onAccept={() => void call(`/api/rider/offers/${offer.data?.offerId ?? ""}/accept`)}
          onDecline={() => void call(`/api/rider/offers/${offer.data?.offerId ?? ""}/decline`)}
        />
      ) : online ? (
        <p className="text-ink-muted" data-testid="waiting-for-jobs">
          {t("waiting")}
        </p>
      ) : null}

      {earnings.data ? <EarningsCard earnings={earnings.data} /> : null}
      <PushOptIn />
    </div>
  );
}

function CashBanner({ amount }: { readonly amount: number }): JSX.Element | null {
  const t = useTranslations("Rider");
  if (amount <= 0) return null;
  return (
    <p
      className="bg-accent-400 text-ink flex items-center gap-2 rounded-xl p-3 text-lg font-bold"
      data-testid="cod-banner"
    >
      <Banknote className="size-6 shrink-0" aria-hidden />
      {t("collect", { amount: formatPeso(amount) })}
    </p>
  );
}

function OfferCard({
  offer,
  busy,
  onAccept,
  onDecline,
}: {
  readonly offer: Wire<RiderOffer>;
  readonly busy: boolean;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
}): JSX.Element {
  const t = useTranslations("Rider.offer");
  const now = useNow(true);
  const left = secondsLeft(offer.expiresAt, now);
  return (
    <section
      className="border-brand-600 flex flex-col gap-3 rounded-xl border-2 p-4"
      aria-label={t("title")}
      data-testid="offer-card"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-ink text-xl font-bold">{t("title")}</h2>
        <span
          className="text-ink font-mono text-lg"
          aria-live="polite"
          data-testid="offer-countdown"
        >
          {t("seconds", { seconds: left })}
        </span>
      </div>
      <p className="text-brand-800 text-3xl font-bold" data-testid="offer-pay">
        {t("earn", { amount: formatPeso(offer.earningsCentavos) })}
      </p>
      {offer.tipCentavos > 0 ? (
        <p className="text-ink">{t("tip", { amount: formatPeso(offer.tipCentavos) })}</p>
      ) : null}
      <p className="text-ink flex items-center gap-2">
        <Store className="size-5 shrink-0" aria-hidden />
        {offer.storeName}
        {offer.storeAddress ? ` · ${offer.storeAddress}` : ""}
      </p>
      <p className="text-ink flex items-center gap-2">
        <MapPin className="size-5 shrink-0" aria-hidden />
        {t("trip", { km: km(offer.tripMeters), area: offer.dropoffArea ?? t("nearby") })}
      </p>
      <CashBanner amount={offer.cashToCollectCentavos} />
      <SwipeConfirm label={t("accept")} onConfirm={onAccept} disabled={busy || left === 0} />
      <Button variant="secondary" disabled={busy} onClick={onDecline}>
        {t("decline")}
      </Button>
    </section>
  );
}

function NavLinks({ to }: { readonly to: { lat: number; lng: number } }): JSX.Element {
  const t = useTranslations("Rider.job");
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button variant="secondary" asChild>
        <a href={wazeLink(to)} target="_blank" rel="noopener noreferrer" data-testid="waze-link">
          <Navigation className="size-4" aria-hidden /> {t("waze")}
        </a>
      </Button>
      <Button variant="secondary" asChild>
        <a
          href={googleMapsLink(to)}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="gmaps-link"
        >
          <Navigation className="size-4" aria-hidden /> {t("googleMaps")}
        </a>
      </Button>
    </div>
  );
}

function JobCard({
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
}): JSX.Element {
  const t = useTranslations("Rider.job");
  const [pin, setPin] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const toStore = job.status !== "picked_up";
  const base = `/api/rider/jobs/${job.orderId}`;

  const deliver = async (): Promise<void> => {
    setSending(true);
    onError(null);
    const form = new FormData();
    if (pin) form.set("pin", pin);
    if (photo) {
      // Small WebP photos upload quickly on mobile data and stay under the bucket limit.
      const small = await compressToWebp(photo).catch(() => photo);
      form.set("photo", new File([small], "proof.webp", { type: small.type || photo.type }));
    }
    const result = await requestJson<unknown>("POST", `${base}/delivered`, form, t("failed"));
    setSending(false);
    if (!result.ok) onError(result.message);
    refresh();
  };

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border p-4"
      aria-label={t("title")}
      data-testid="job-card"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-ink text-xl font-bold">{t("title")}</h2>
        <span className="text-ink-muted text-sm">{job.code}</span>
      </div>
      <p className="text-ink font-semibold" role="status" data-testid="job-step">
        {t(
          `step.${job.status === "picked_up" ? "toCustomer" : job.arrivedStoreAt ? "atStore" : "toStore"}`,
        )}
      </p>
      <p className="text-ink">
        {t("pay", { amount: formatPeso(job.earningsCentavos + job.tipCentavos) })}
      </p>
      <CashBanner amount={job.cashToCollectCentavos} />

      {toStore ? (
        <div className="flex flex-col gap-1">
          <p className="text-ink flex items-center gap-2 font-semibold">
            <Store className="size-5 shrink-0" aria-hidden /> {job.store.name}
          </p>
          {job.store.address ? <p className="text-ink-muted">{job.store.address}</p> : null}
          <ul className="text-ink list-disc pl-6 text-sm">
            {job.items.map((item) => (
              <li key={item.name}>
                {item.quantity} × {item.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-col gap-1" data-testid="dropoff">
        <p className="text-ink flex items-center gap-2 font-semibold">
          <MapPin className="size-5 shrink-0" aria-hidden />
          {[job.dropoff.label, job.dropoff.street, job.dropoff.barangay]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {job.dropoff.landmark ? (
          <p className="text-ink">{t("landmark", { landmark: job.dropoff.landmark })}</p>
        ) : null}
        {job.dropoff.notes ? (
          <p className="text-ink-muted">{t("notes", { notes: job.dropoff.notes })}</p>
        ) : null}
        {job.contactPhone ? (
          <p
            className="text-ink-muted flex items-center gap-2 text-sm"
            data-testid="masked-contact"
          >
            <Phone className="size-4" aria-hidden /> {job.contactPhone} · {t("callSoon")}
          </p>
        ) : null}
      </div>
      <NavLinks to={toStore ? job.store.location : job.dropoff.location} />

      {toStore && !job.arrivedStoreAt ? (
        <SwipeConfirm
          label={t("arrived")}
          disabled={busy}
          onConfirm={() => void call(`${base}/arrived`)}
        />
      ) : null}
      {toStore && job.arrivedStoreAt ? (
        job.status === "ready" ? (
          <SwipeConfirm
            label={t("pickedUp")}
            disabled={busy}
            onConfirm={() => void call(`${base}/picked-up`)}
          />
        ) : (
          <p className="text-ink-muted" data-testid="waiting-for-store">
            {t("waitingForStore")}
          </p>
        )
      ) : null}
      {!toStore ? (
        <div className="flex flex-col gap-3">
          {job.pinRequired ? (
            <label className="text-ink flex flex-col gap-1 font-semibold">
              {t("pin")}
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                pattern="[0-9]{4}"
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
                className="border-border text-ink rounded-lg border px-3 py-3 text-center text-2xl tracking-widest"
              />
            </label>
          ) : null}
          <label className="text-ink flex flex-col gap-1 font-semibold">
            {job.pinRequired ? t("photoOptional") : t("photo")}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
              className="text-ink text-sm"
            />
          </label>
          <SwipeConfirm
            label={t("delivered")}
            disabled={sending || (job.pinRequired ? pin.length !== 4 : photo === null)}
            onConfirm={() => void deliver()}
          />
        </div>
      ) : null}
    </section>
  );
}

function EarningsCard({ earnings }: { readonly earnings: RiderEarnings }): JSX.Element {
  const t = useTranslations("Rider.earnings");
  return (
    <section
      className="bg-surface-muted flex flex-col gap-2 rounded-xl p-4"
      aria-label={t("title")}
      data-testid="earnings"
    >
      <h2 className="text-ink text-lg font-bold">{t("title")}</h2>
      <dl className="grid grid-cols-2 gap-2">
        <div>
          <dt className="text-ink-muted text-sm">{t("today", { jobs: earnings.today.jobs })}</dt>
          <dd className="text-ink text-xl font-bold" data-testid="earnings-today">
            {formatPeso(earnings.today.payCentavos + earnings.today.tipCentavos)}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted text-sm">{t("week", { jobs: earnings.week.jobs })}</dt>
          <dd className="text-ink text-xl font-bold">
            {formatPeso(earnings.week.payCentavos + earnings.week.tipCentavos)}
          </dd>
        </div>
      </dl>
      <p className="text-ink text-sm" data-testid="cash-on-hand">
        {t("cash", {
          held: formatPeso(earnings.cashHeldCentavos),
          limit: formatPeso(earnings.cashLimitCentavos),
        })}
      </p>
    </section>
  );
}
