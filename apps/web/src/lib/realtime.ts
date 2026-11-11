"use client";

import {
  createClient,
  REALTIME_SUBSCRIBE_STATES,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";

interface Access {
  url: string;
  anonKey: string;
  accessToken: string;
  expiresAt: number | null;
}

/** Live-update connection state, for a small "Live" badge and to slow polling down. */
export type LiveState = "connecting" | "live" | "offline";

let client: SupabaseClient | null = null;
let pending: Promise<SupabaseClient | null> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;

async function fetchAccess(): Promise<Access | null> {
  try {
    const response = await fetch("/api/realtime/token", { cache: "no-store" });
    if (!response.ok) return null;
    const envelope = (await response.json()) as { data?: Access };
    return envelope.data ?? null;
  } catch {
    return null;
  }
}

/**
 * One Realtime connection per tab. The BFF hands over the session's access token; this client
 * never signs in, refreshes sessions or reads tables: it only listens on private channels, and the
 * token is re-fetched shortly before it expires.
 */
async function connect(): Promise<SupabaseClient | null> {
  const access = await fetchAccess();
  if (!access) return null;
  client ??= createClient(access.url, access.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  await client.realtime.setAuth(access.accessToken);
  clearTimeout(refreshTimer);
  if (access.expiresAt) {
    const inMs = Math.max(30_000, access.expiresAt * 1000 - Date.now() - 60_000);
    refreshTimer = setTimeout(() => {
      pending = connect();
    }, inMs);
  }
  return client;
}

function liveClient(): Promise<SupabaseClient | null> {
  pending ??= connect();
  return pending;
}

/** Broadcast events: order changes, offers to a rider, and the assigned rider moving. */
export type LiveEvent = "status" | "offer" | "location";

const STATUS_ONLY: readonly LiveEvent[] = ["status"];

/**
 * Calls `onChange` whenever the server broadcasts one of `events` on `topic` (`order:<id>`,
 * `merchant:<id>` or `rider:<id>`). Events carry ids only; the caller refetches through the BFF.
 */
export function useLiveTopic(
  topic: string | null,
  onChange: () => void,
  events: readonly LiveEvent[] = STATUS_ONLY,
): LiveState {
  const [state, setState] = useState<LiveState>("connecting");
  const callback = useRef(onChange);
  // A string, so a new array with the same events does not re-subscribe.
  const eventList = events.join(",");
  useEffect(() => {
    callback.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!topic) return undefined;
    let cancelled = false;
    let remove: (() => void) | undefined;
    void liveClient().then((supabase) => {
      if (cancelled) return;
      if (!supabase) {
        setState("offline");
        return;
      }
      const channel = supabase.channel(topic, { config: { private: true } });
      for (const event of eventList.split(",")) {
        channel.on("broadcast", { event }, () => callback.current());
      }
      channel.subscribe((status) => {
        if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
          setState("live");
          // Catch up on anything that changed while connecting.
          callback.current();
        } else {
          // CHANNEL_ERROR, TIMED_OUT or CLOSED: screens fall back to polling.
          setState("offline");
        }
      });
      remove = () => void supabase.removeChannel(channel);
    });
    return () => {
      cancelled = true;
      remove?.();
    };
  }, [topic, eventList]);

  return topic ? state : "offline";
}
