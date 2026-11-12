"use client";

import "leaflet/dist/leaflet.css";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import { useEffect, useRef, type JSX } from "react";
import { mapTileUrl } from "@/lib/map-tiles";

const TILES = mapTileUrl(process.env.NEXT_PUBLIC_MAP_TILE_URL);
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export interface MapDot {
  readonly id: string;
  readonly lat: number;
  readonly lng: number;
  readonly label: string;
  readonly kind: "rider-online" | "rider-offline" | "order" | "order-late";
}

const CLASSES: Readonly<Record<MapDot["kind"], string>> = {
  "rider-online": "fill-brand-600 stroke-white",
  "rider-offline": "fill-ink-muted stroke-white",
  order: "fill-accent-400 stroke-ink",
  "order-late": "fill-danger-900 stroke-white",
};

/** The console map: riders and live orders as dots, refitted when the set of dots changes. */
export function OpsMap({
  dots,
  label,
}: {
  readonly dots: readonly MapDot[];
  readonly label: string;
}): JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const fitted = useRef("");

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !container.current) return;
      if (!map.current) {
        map.current = L.map(container.current, { zoomControl: true }).setView(
          [14.5547, 121.0244],
          13,
        );
        L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map.current);
        layer.current = L.layerGroup().addTo(map.current);
      }
      layer.current?.clearLayers();
      for (const dot of dots) {
        L.circleMarker([dot.lat, dot.lng], {
          radius: dot.kind.startsWith("rider") ? 8 : 7,
          className: CLASSES[dot.kind],
          fillOpacity: 1,
          weight: 2,
        })
          .bindTooltip(dot.label)
          .addTo(layer.current as LayerGroup);
      }
      // Refit only when dots appear or disappear, so moving riders don't make the map jump.
      const key = dots
        .map((d) => d.id)
        .sort()
        .join(",");
      if (dots.length > 0 && key !== fitted.current) {
        fitted.current = key;
        map.current.fitBounds(L.latLngBounds(dots.map((d) => [d.lat, d.lng])), {
          padding: [24, 24],
          maxZoom: 15,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dots]);

  useEffect(
    () => () => {
      map.current?.remove();
      map.current = null;
    },
    [],
  );

  return (
    <div>
      <div
        ref={container}
        className="border-border h-72 w-full overflow-hidden rounded-xl border"
        aria-describedby="ops-map-label"
      />
      <p id="ops-map-label" className="sr-only">
        {label}
      </p>
    </div>
  );
}
