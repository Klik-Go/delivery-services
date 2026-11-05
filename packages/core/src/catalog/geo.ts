import type { GeoPoint } from "../merchant/ports";

const EARTH_RADIUS_M = 6_371_008.8;

/** Roads are longer than the straight line; 1.3 is a common urban detour factor (configurable). */
export const ROAD_FACTOR = 1.3;

/** Average motorcycle speed in city traffic, used for arrival estimates. */
export const RIDER_SPEED_KMH = 20;

/** Great-circle distance in metres. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = (degrees: number): number => (degrees * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimated road distance in whole metres (haversine × road factor). */
export function roadMeters(a: GeoPoint, b: GeoPoint, factor = ROAD_FACTOR): number {
  return Math.round(haversineMeters(a, b) * factor);
}

/** Arrival window in minutes: preparation + ride, as a 10-minute range rounded to 5. */
export function etaRange(prepMinutes: number, distanceM: number): { min: number; max: number } {
  const ride = Math.ceil((distanceM / 1000 / RIDER_SPEED_KMH) * 60);
  const min = Math.max(10, Math.round((prepMinutes + ride) / 5) * 5);
  return { min, max: min + 10 };
}
