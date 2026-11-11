import { DEFAULT_DISPATCH_SETTINGS, type DispatchSettings } from "./ports";

const num = (raw: unknown, fallback: number, min: number): number =>
  typeof raw === "number" && Number.isFinite(raw) && raw >= min ? raw : fallback;

/**
 * Reads the `dispatch` feature flag's rollout JSON (snake_case, as admins edit it). Values that are
 * missing or out of range fall back to the defaults, so a typo cannot stop dispatch.
 */
export function parseDispatchSettings(rollout: unknown): DispatchSettings {
  const r: Record<string, unknown> =
    typeof rollout === "object" && rollout !== null ? (rollout as Record<string, unknown>) : {};
  const d = DEFAULT_DISPATCH_SETTINGS;
  return {
    offerSeconds: num(r.offer_seconds, d.offerSeconds, 10),
    maxAttempts: Math.floor(num(r.max_attempts, d.maxAttempts, 1)),
    maxDistanceM: num(r.max_distance_m, d.maxDistanceM, 100),
    start: r.start === "before_ready" ? "before_ready" : "accept",
    leadMinutes: num(r.lead_minutes, d.leadMinutes, 0),
    pinThresholdCentavos: Math.floor(num(r.pin_threshold_centavos, d.pinThresholdCentavos, 0)),
    riderBaseCentavos: Math.floor(num(r.rider_base_centavos, d.riderBaseCentavos, 0)),
    riderPerKmCentavos: Math.floor(num(r.rider_per_km_centavos, d.riderPerKmCentavos, 0)),
    riderFreeKm: num(r.rider_free_km, d.riderFreeKm, 0),
    avgSpeedKph: num(r.avg_speed_kph, d.avgSpeedKph, 1),
  };
}
