"use client";

import { useEffect, useRef, useState } from "react";
import { requestJson } from "@/lib/post-json";
import { HEARTBEAT_MS, shouldSend, type Fix } from "@/lib/rider-location";

/** Whether the screen is kept awake: on, not possible in this browser, or refused. */
export type WakeState = "on" | "unsupported" | "off";

/**
 * Keeps the screen on while the rider is online (Screen Wake Lock API). Browsers drop the lock when
 * the tab is hidden, so it is taken again when the rider comes back to the app.
 */
export function useWakeLock(active: boolean): WakeState {
  const [state, setState] = useState<WakeState>("off");
  useEffect(() => {
    if (!active) return undefined;
    if (!("wakeLock" in navigator)) {
      setState("unsupported");
      return undefined;
    }
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async (): Promise<void> => {
      try {
        lock = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void lock.release();
          return;
        }
        setState("on");
        lock.addEventListener("release", () => setState("off"));
      } catch {
        setState("off");
      }
    };
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [active]);
  return active ? state : "off";
}

/** Where location sharing stands, for the status line under the online switch. */
export type GpsState = "idle" | "sharing" | "denied" | "unavailable";

/**
 * Shares the rider's position while online: every 7 seconds when they move more than 15 m, and at
 * least once a minute so dispatch still sees them. Stops the moment `active` turns false (offline)
 * or the server refuses (it only accepts positions from online riders).
 */
export function useLocationSharing(active: boolean, onRefused: () => void): GpsState {
  const [state, setState] = useState<GpsState>("idle");
  const refused = useRef(onRefused);
  useEffect(() => {
    refused.current = onRefused;
  }, [onRefused]);

  useEffect(() => {
    if (!active) return undefined;
    if (!("geolocation" in navigator)) {
      setState("unavailable");
      return undefined;
    }
    let last: Fix | null = null;
    let latest: (Fix & { heading?: number; speedKph?: number; accuracyM?: number }) | null = null;
    let stopped = false;
    const send = async (fix: NonNullable<typeof latest>): Promise<void> => {
      last = fix;
      const result = await requestJson<unknown>(
        "POST",
        "/api/rider/location",
        {
          lat: fix.lat,
          lng: fix.lng,
          ...(fix.heading === undefined ? {} : { heading: fix.heading }),
          ...(fix.speedKph === undefined ? {} : { speedKph: fix.speedKph }),
          ...(fix.accuracyM === undefined ? {} : { accuracyM: fix.accuracyM }),
        },
        "",
      );
      if (!result.ok && result.code === "CONFLICT" && !stopped) refused.current();
    };
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, heading, speed, accuracy } = position.coords;
        latest = {
          lat: latitude,
          lng: longitude,
          at: Date.now(),
          ...(heading !== null && Number.isFinite(heading) ? { heading } : {}),
          ...(speed !== null && Number.isFinite(speed) ? { speedKph: speed * 3.6 } : {}),
          ...(Number.isFinite(accuracy) ? { accuracyM: accuracy } : {}),
        };
        setState("sharing");
        if (shouldSend(last, latest)) void send(latest);
      },
      (error) => setState(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20_000 },
    );
    // Phones stop reporting when the rider stands still: re-send the last fix as a heartbeat.
    const heartbeat = setInterval(() => {
      if (latest && last && Date.now() - last.at >= HEARTBEAT_MS) {
        void send({ ...latest, at: Date.now() });
      }
    }, 15_000);
    return () => {
      stopped = true;
      navigator.geolocation.clearWatch(watch);
      clearInterval(heartbeat);
    };
  }, [active]);
  return active ? state : "idle";
}
