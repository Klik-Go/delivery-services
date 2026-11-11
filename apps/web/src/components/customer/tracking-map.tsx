"use client";

import "leaflet/dist/leaflet.css";
import type { TrackingView } from "@klikgo/core";
import type { CircleMarker, LayerGroup, Map as LeafletMap } from "leaflet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bike } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, type JSX } from "react";
import { mapTileUrl } from "@/lib/map-tiles";
import { fetchData } from "@/lib/post-json";
import { useLiveTopic } from "@/lib/realtime";

const TILES = mapTileUrl(process.env.NEXT_PUBLIC_MAP_TILE_URL);
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
/** The map refetches at most this often, however fast the rider's app sends positions. */
const REFRESH_MS = 5000;

type Wire = Omit<TrackingView, "rider"> & {
  rider:
    (Omit<NonNullable<TrackingView["rider"]>, "locationAt"> & { locationAt: string | null }) | null;
};

/**
 * The customer's live map (BUILD_PLAN Phase 7): store, drop-off and, while a rider holds the job,
 * the rider moving, with an arrival estimate. Rider moves arrive as "location" events on the
 * order's private channel and refetch the BFF, throttled to one request per 5 seconds.
 */
export function TrackingMap({ orderId }: { readonly orderId: string }): JSX.Element | null {
  const t = useTranslations("Customer.order.tracking");
  const queryClient = useQueryClient();
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refresh = useCallback(() => {
    const wait = Math.max(0, last.current + REFRESH_MS - Date.now());
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      last.current = Date.now();
      void queryClient.invalidateQueries({ queryKey: ["tracking", orderId] });
    }, wait);
  }, [queryClient, orderId]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const live = useLiveTopic(`order:${orderId}`, refresh, ["location", "status"]);
  const tracking = useQuery({
    queryKey: ["tracking", orderId],
    queryFn: () => fetchData<Wire>(`/api/orders/${orderId}/tracking`, t("failed")),
    refetchInterval: live === "live" ? 30_000 : REFRESH_MS,
  });

  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layers = useRef<LayerGroup | null>(null);
  const riderDot = useRef<CircleMarker | null>(null);
  const data = tracking.data;

  // Create the map once the first answer arrives; later answers only move the rider.
  useEffect(() => {
    if (!data || map.current) return undefined;
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !container.current || map.current) return;
      const instance = L.map(container.current, { zoomControl: false, attributionControl: true });
      L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(instance);
      const group = L.layerGroup().addTo(instance);
      L.circleMarker([data.store.lat, data.store.lng], {
        radius: 9,
        className: "fill-accent-400 stroke-ink",
        fillOpacity: 1,
      })
        .bindTooltip(t("store"))
        .addTo(group);
      L.circleMarker([data.dropoff.lat, data.dropoff.lng], {
        radius: 9,
        className: "fill-brand-800 stroke-white",
        fillOpacity: 1,
      })
        .bindTooltip(t("you"))
        .addTo(group);
      instance.fitBounds(
        L.latLngBounds([data.store.lat, data.store.lng], [data.dropoff.lat, data.dropoff.lng]),
        { padding: [32, 32], maxZoom: 16 },
      );
      map.current = instance;
      layers.current = group;
    });
    return () => {
      cancelled = true;
    };
  }, [data, t]);

  useEffect(
    () => () => {
      map.current?.remove();
      map.current = null;
    },
    [],
  );

  const riderAt = data?.rider?.location ?? null;
  useEffect(() => {
    void import("leaflet").then((L) => {
      if (!map.current || !layers.current) return;
      if (!riderAt) {
        riderDot.current?.remove();
        riderDot.current = null;
        return;
      }
      if (riderDot.current) {
        riderDot.current.setLatLng([riderAt.lat, riderAt.lng]);
      } else {
        riderDot.current = L.circleMarker([riderAt.lat, riderAt.lng], {
          radius: 11,
          className: "fill-brand-600 stroke-white",
          fillOpacity: 1,
          weight: 3,
        }).addTo(layers.current);
      }
    });
  }, [riderAt]);

  if (tracking.isPending || tracking.isError || !data) return null;
  const rider = data.rider;
  return (
    <section className="flex flex-col gap-2" aria-label={t("title")} data-testid="tracking">
      <div
        ref={container}
        className="border-border h-56 w-full overflow-hidden rounded-xl border"
        role="img"
        aria-label={t("mapLabel")}
      />
      {rider ? (
        <div
          className="bg-brand-50 flex items-center gap-3 rounded-xl p-3"
          data-testid="rider-card"
        >
          <Bike className="text-brand-800 size-6 shrink-0" aria-hidden />
          <div className="flex-1">
            <p
              className="text-ink font-semibold"
              data-testid={riderAt ? "rider-on-map" : undefined}
            >
              {t("rider", { name: rider.firstName ?? t("yourRider"), plate: rider.plateNo ?? "" })}
            </p>
            {data.etaMinutes !== null ? (
              <p className="text-ink" data-testid="tracking-eta">
                {t("eta", { minutes: data.etaMinutes })}
              </p>
            ) : (
              <p className="text-ink-muted">{t("noFix")}</p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-ink-muted" data-testid="finding-rider">
          {t("finding")}
        </p>
      )}
    </section>
  );
}
