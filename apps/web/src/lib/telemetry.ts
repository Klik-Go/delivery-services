import type { AnalyticsEventInput, ClientErrorInput } from "@klikgo/types";
import { postJson } from "./post-json";

const sent = new Set<string>();

/** Reports one ordering-funnel step (ids only), at most once per page load and key. */
export function trackFunnel(event: AnalyticsEventInput, onceKey?: string): void {
  const key = onceKey ?? `${event.name}:${event.storeId ?? ""}:${event.orderId ?? ""}`;
  if (sent.has(key)) return;
  sent.add(key);
  void postJson("/api/events", event, "");
}

let reported = 0;

/** Reports a browser crash to the BFF (which scrubs it and forwards it); a few per page at most. */
export function reportClientError(report: ClientErrorInput): void {
  if (reported >= 5) return;
  reported += 1;
  void postJson(
    "/api/client-errors",
    { ...report, message: report.message.slice(0, 500), stack: report.stack?.slice(0, 4000) },
    "",
  );
}

/** The page path without its query string (queries can hold codes and search text). */
export function currentPath(): string {
  return window.location.pathname.replace(/[^A-Za-z0-9/_\-.]/g, "").slice(0, 200) || "/";
}
