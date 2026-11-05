"use client";

import { WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useSyncExternalStore, type JSX } from "react";

function subscribe(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/** A banner while the phone is offline (pages and the feed then come from the service worker). */
export function OfflineBanner(): JSX.Element | null {
  const t = useTranslations("Customer");
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  if (online) return null;
  return (
    <p
      role="status"
      className="bg-ink sticky top-0 z-30 flex items-center justify-center gap-2 px-4 py-2 text-sm text-white"
    >
      <WifiOff aria-hidden className="size-4" />
      {t("offline")}
    </p>
  );
}

/** Registers /sw.js in production builds (development stays cache-free). */
export function ServiceWorkerRegister(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
