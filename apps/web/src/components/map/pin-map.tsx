"use client";

import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap } from "leaflet";
import { MapPin } from "lucide-react";
import { useEffect, useRef, type JSX } from "react";
import { mapTileUrl } from "@/lib/map-tiles";

/** A point on the map. */
export interface Pin {
  readonly lat: number;
  readonly lng: number;
}

/** OSM-based tiles (attribution required); NEXT_PUBLIC_MAP_TILE_URL picks the provider. */
const TILES = mapTileUrl(process.env.NEXT_PUBLIC_MAP_TILE_URL);
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/**
 * A map with a fixed pin in the middle: people move the map under the pin, which works well with
 * one thumb on a phone. Reports the centre after every move. Leaflet loads only in the browser.
 */
export function PinMap({
  value,
  onChange,
  label,
}: {
  readonly value: Pin;
  readonly onChange: (pin: Pin) => void;
  readonly label: string;
}): JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !container.current || map.current) return;
      const instance = L.map(container.current, { zoomControl: true, attributionControl: true });
      instance.setView([value.lat, value.lng], 17);
      L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(instance);
      instance.on("moveend", () => {
        const centre = instance.getCenter();
        onChangeRef.current({
          lat: Number(centre.lat.toFixed(6)),
          lng: Number(centre.lng.toFixed(6)),
        });
      });
      map.current = instance;
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // The map is created once; later `value` changes recentre it below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const centre = instance.getCenter();
    if (Math.abs(centre.lat - value.lat) > 1e-6 || Math.abs(centre.lng - value.lng) > 1e-6)
      instance.setView([value.lat, value.lng]);
  }, [value]);

  return (
    <div className="rounded-card border-brand-100 relative h-72 w-full overflow-hidden border-2">
      <div ref={container} role="application" aria-label={label} className="h-full w-full" />
      <MapPin
        aria-hidden
        className="text-brand-800 pointer-events-none absolute top-1/2 left-1/2 z-[1000] size-10 -translate-x-1/2 -translate-y-full drop-shadow"
        fill="currentColor"
        stroke="white"
      />
    </div>
  );
}
