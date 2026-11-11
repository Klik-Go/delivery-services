/** A GPS fix from the browser. */
export interface Fix {
  readonly lat: number;
  readonly lng: number;
  readonly at: number;
}

/** Positions go out every 7 seconds while the rider moves (the brief asks for 5–10). */
export const SEND_EVERY_MS = 7000;
/** Smaller moves are GPS jitter; staying put does not need a new position every 7 seconds. */
export const MIN_MOVE_M = 15;
/**
 * Dispatch only offers jobs to riders seen in the last 2 minutes (nearest_available_riders), so a
 * rider standing still still checks in every minute.
 */
export const HEARTBEAT_MS = 60_000;

/** Straight-line metres between two fixes (equirectangular: plenty for a few hundred metres). */
export function metresBetween(a: Pick<Fix, "lat" | "lng">, b: Pick<Fix, "lat" | "lng">): number {
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

/** Whether this fix should be sent, given the last one sent. */
export function shouldSend(last: Fix | null, next: Fix): boolean {
  if (!last) return true;
  const elapsed = next.at - last.at;
  if (elapsed >= HEARTBEAT_MS) return true;
  return elapsed >= SEND_EVERY_MS && metresBetween(last, next) >= MIN_MOVE_M;
}

/** Turn-by-turn in Waze. */
export function wazeLink(to: Pick<Fix, "lat" | "lng">): string {
  return `https://waze.com/ul?ll=${to.lat.toFixed(6)},${to.lng.toFixed(6)}&navigate=yes`;
}

/** Turn-by-turn in Google Maps. */
export function googleMapsLink(to: Pick<Fix, "lat" | "lng">): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${to.lat.toFixed(6)},${to.lng.toFixed(6)}&travelmode=driving`;
}

/** Seconds left on an offer, never below zero. */
export function secondsLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
}
