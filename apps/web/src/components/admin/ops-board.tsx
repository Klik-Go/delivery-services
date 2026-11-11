"use client";

import { formatPeso, type LiveMap, type OpsBoardOrder } from "@klikgo/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo, useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { fetchData } from "@/lib/post-json";
import { useLiveTopic } from "@/lib/realtime";
import { OpsMap, type MapDot } from "./ops-map";
import { SlaBadge } from "./sla-badge";
import { manilaTime, type Wire } from "./wire";

const ORDER: Readonly<Record<string, number>> = { late: 0, at_risk: 1, on_time: 2 };

/**
 * The console's live board (docs/BUILD_PLAN.md Phase 8): orders in the person's zones with SLA
 * colours, late first, and a map of riders and orders. Live over the zone's private channel when
 * one zone is chosen; polling keeps it fresh otherwise.
 */
export function OpsBoard({
  zones,
}: {
  readonly zones: readonly { readonly id: string; readonly name: string }[];
}): JSX.Element {
  const t = useTranslations("Ops.board");
  const tStatus = useTranslations("Customer.order.status");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [zoneId, setZoneId] = useState<string>(zones.length === 1 ? (zones[0]?.id ?? "") : "");
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["ops-live"] });
  }, [queryClient]);
  const live = useLiveTopic(zoneId ? `zone:${zoneId}` : null, refresh, ["status", "location"]);
  const map = useQuery({
    queryKey: ["ops-live", zoneId],
    queryFn: () => fetchData<Wire<LiveMap>>("/api/admin/live", t("failed")),
    refetchInterval: live === "live" ? 30_000 : 10_000,
  });

  const orders = useMemo(() => {
    const all = (map.data?.orders ?? []).filter((o) => !zoneId || o.zoneId === zoneId);
    return [...all].sort(
      (a, b) => (ORDER[a.sla?.state ?? "on_time"] ?? 2) - (ORDER[b.sla?.state ?? "on_time"] ?? 2),
    );
  }, [map.data, zoneId]);
  const riders = useMemo(
    () =>
      (map.data?.riders ?? []).filter(
        (r) => r.status === "active" && (!zoneId || r.zoneId === zoneId),
      ),
    [map.data, zoneId],
  );
  const dots = useMemo<MapDot[]>(
    () => [
      ...riders.flatMap((r) =>
        r.location
          ? [
              {
                id: `r-${r.id}`,
                lat: r.location.lat,
                lng: r.location.lng,
                label: r.name ?? "Rider",
                kind: r.isOnline ? ("rider-online" as const) : ("rider-offline" as const),
              },
            ]
          : [],
      ),
      ...orders.map((o) => ({
        id: `o-${o.id}`,
        lat: o.dropoff.lat,
        lng: o.dropoff.lng,
        label: `${o.code} · ${o.merchantName}`,
        kind: o.sla?.state === "late" ? ("order-late" as const) : ("order" as const),
      })),
    ],
    [riders, orders],
  );

  if (map.isPending) return <p className="text-ink-muted">{t("loading")}</p>;
  if (map.isError) return <FormError message={map.error.message} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {zones.length > 1 ? (
          <label className="text-ink flex items-center gap-2 font-semibold">
            {t("zone")}
            <select
              value={zoneId}
              onChange={(event) => setZoneId(event.target.value)}
              className="border-border bg-surface min-h-tap rounded-lg border px-3"
            >
              <option value="">{t("allZones")}</option>
              {zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <p className="text-ink-muted text-sm" data-testid="riders-online">
          {t("ridersOnline", { count: riders.filter((r) => r.isOnline).length })}
          {live === "live" ? ` · ${t("live")}` : ""}
        </p>
      </div>
      <OpsMap dots={dots} label={t("map")} />
      {orders.length === 0 ? (
        <p className="text-ink-muted">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="ops-board">
          {orders.map((order) => (
            <BoardCard
              key={order.id}
              order={order}
              statusLabel={tStatus(order.status)}
              locale={locale}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function BoardCard({
  order,
  statusLabel,
  locale,
}: {
  readonly order: Wire<OpsBoardOrder>;
  readonly statusLabel: string;
  readonly locale: string;
}): JSX.Element {
  const t = useTranslations("Ops.board");
  return (
    <li
      className="bg-surface-muted flex flex-wrap items-center gap-3 rounded-xl p-3"
      data-code={order.code}
      data-status={order.status}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-ink font-semibold">
          {order.code} · {order.merchantName}
        </p>
        <p className="text-ink-muted text-sm">
          {statusLabel} · {formatPeso(order.totalCentavos)} ·{" "}
          {order.riderName ? t("rider", { name: order.riderName }) : t("noRider")}
        </p>
        <p className="text-ink-muted text-sm">
          {order.sla ? t("due", { time: manilaTime(order.sla.dueAt, locale) }) : null}
          {order.dispatchFlaggedAt && !order.riderId ? ` · ${t("unassigned")}` : ""}
          {order.flaggedAt && order.status === "placed" ? ` · ${t("storeLate")}` : ""}
        </p>
      </div>
      {order.sla ? <SlaBadge state={order.sla.state} /> : null}
      <Link
        href={`/admin/orders/${order.id}`}
        className="bg-brand-800 min-h-tap inline-flex items-center rounded-full px-4 font-semibold text-white"
      >
        {t("open")}
      </Link>
    </li>
  );
}
