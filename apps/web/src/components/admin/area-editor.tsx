"use client";

import "leaflet/dist/leaflet.css";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type JSX } from "react";
import { Button } from "@klikgo/ui";
import { mapTileUrl } from "@/lib/map-tiles";

const TILES = mapTileUrl(process.env.NEXT_PUBLIC_MAP_TILE_URL);
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

type Ring = [number, number][];

/**
 * Draws a zone's outline: click to add a corner, drag a corner to move it. Corners are [lng, lat]
 * like GeoJSON. The server rejects outlines whose edges cross.
 */
export function AreaEditor({
  initial,
  disabled,
  busy,
  onSave,
}: {
  /** Corners as [lng, lat] (JSON gives them as plain arrays). */
  readonly initial: readonly (readonly number[])[];
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly onSave: (ring: Ring) => void;
}): JSX.Element {
  const t = useTranslations("Ops.zones");
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const [ring, setRing] = useState<Ring>(() => initial.map(([lng = 0, lat = 0]) => [lng, lat]));

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !container.current || map.current) return;
      const instance = L.map(container.current);
      L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(instance);
      layer.current = L.layerGroup().addTo(instance);
      if (initial.length > 0) {
        instance.fitBounds(L.latLngBounds(initial.map(([lng = 0, lat = 0]) => [lat, lng])), {
          padding: [16, 16],
        });
      } else {
        instance.setView([14.5547, 121.0244], 12);
      }
      if (!disabled) {
        instance.on("click", (event) => {
          setRing((current) => [
            ...current,
            [Number(event.latlng.lng.toFixed(6)), Number(event.latlng.lat.toFixed(6))],
          ]);
        });
      }
      map.current = instance;
    });
    return () => {
      cancelled = true;
    };
    // The map is created once per zone; corners are drawn by the effect below.
  }, [initial, disabled]);

  useEffect(() => {
    void import("leaflet").then((L) => {
      const group = layer.current;
      if (!group) return;
      group.clearLayers();
      if (ring.length >= 2) {
        L.polygon(
          ring.map(([lng, lat]) => [lat, lng]),
          { className: "fill-brand-200 stroke-brand-800", weight: 2, fillOpacity: 0.3 },
        ).addTo(group);
      }
      ring.forEach(([lng, lat], index) => {
        const marker = L.marker([lat, lng], {
          draggable: !disabled,
          keyboard: true,
          title: `${String(index + 1)}`,
          icon: L.divIcon({
            className: "bg-brand-800 rounded-full border-2 border-white",
            iconSize: [14, 14],
          }),
        }).addTo(group);
        marker.on("dragend", () => {
          const position = marker.getLatLng();
          setRing((current) =>
            current.map((corner, i) =>
              i === index
                ? [Number(position.lng.toFixed(6)), Number(position.lat.toFixed(6))]
                : corner,
            ),
          );
        });
      });
    });
  }, [ring, disabled]);

  useEffect(
    () => () => {
      map.current?.remove();
      map.current = null;
    },
    [],
  );

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={container}
        className="border-border h-80 w-full overflow-hidden rounded-xl border"
        aria-describedby="area-help"
      />
      <p id="area-help" className="text-ink-muted text-sm">
        {disabled ? t("readOnly") : t("areaHelp")} {t("corners", { count: ring.length })}
      </p>
      {!disabled ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            type="button"
            disabled={ring.length === 0}
            onClick={() => setRing((r) => r.slice(0, -1))}
          >
            {t("undo")}
          </Button>
          <Button variant="secondary" type="button" onClick={() => setRing([])}>
            {t("reset")}
          </Button>
          <Button type="button" disabled={busy || ring.length < 3} onClick={() => onSave(ring)}>
            {t("saveArea")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
