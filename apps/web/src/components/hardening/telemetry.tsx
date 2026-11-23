"use client";

import type { FunnelEvent } from "@klikgo/types";
import { useEffect, type JSX } from "react";
import { currentPath, reportClientError, trackFunnel } from "@/lib/telemetry";

/** Counts one funnel step when the page shows (renders nothing). */
export function FunnelStep({
  name,
  storeId,
  orderId,
}: {
  readonly name: FunnelEvent;
  readonly storeId?: string;
  readonly orderId?: string;
}): JSX.Element | null {
  useEffect(() => {
    trackFunnel({
      name,
      path: currentPath(),
      ...(storeId ? { storeId } : {}),
      ...(orderId ? { orderId } : {}),
    });
  }, [name, storeId, orderId]);
  return null;
}

/** Reports uncaught browser errors and rejected promises (renders nothing). */
export function ClientErrorReporter(): JSX.Element | null {
  useEffect(() => {
    const onError = (event: ErrorEvent): void => {
      const error = event.error instanceof Error ? event.error : null;
      reportClientError({
        kind: "error",
        message: error?.message || event.message || "Script error",
        ...(error?.stack ? { stack: error.stack } : {}),
        path: currentPath(),
      });
    };
    const onRejection = (event: PromiseRejectionEvent): void => {
      const reason: unknown = event.reason;
      reportClientError({
        kind: "unhandledrejection",
        message: reason instanceof Error ? reason.message || reason.name : "Unhandled rejection",
        ...(reason instanceof Error && reason.stack ? { stack: reason.stack } : {}),
        path: currentPath(),
      });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
