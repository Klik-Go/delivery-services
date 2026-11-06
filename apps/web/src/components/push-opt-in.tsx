"use client";

import { Button } from "@klikgo/ui";
import { Bell, BellOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type JSX } from "react";
import { fetchData, requestJson } from "@/lib/post-json";

type State = "unsupported" | "off" | "on" | "blocked" | "working";

/** Web Push wants the VAPID key as bytes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * "Get alerts on this phone": subscribes this browser to Web Push through the service worker and
 * saves the subscription via the BFF. Hidden when the browser or the server cannot do push.
 */
export function PushOptIn(): JSX.Element | null {
  const t = useTranslations("Push");
  const [state, setState] = useState<State>("working");
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async (): Promise<void> => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setState("unsupported");
        return;
      }
      const key = await fetchData<{ publicKey: string | null }>("/api/push/key", "").catch(
        () => null,
      );
      if (cancelled) return;
      if (!key?.publicKey) {
        setState("unsupported");
        return;
      }
      setPublicKey(key.publicKey);
      if (Notification.permission === "denied") {
        setState("blocked");
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration();
      const existing = await registration?.pushManager.getSubscription();
      if (!cancelled) setState(existing ? "on" : "off");
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "unsupported") return null;

  const turnOn = async (): Promise<void> => {
    if (!publicKey) return;
    setState("working");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      });
      const saved = await requestJson<unknown>(
        "POST",
        "/api/push/subscriptions",
        subscription.toJSON(),
        "",
      );
      setState(saved.ok ? "on" : "off");
    } catch {
      setState(Notification.permission === "denied" ? "blocked" : "off");
    }
  };

  const turnOff = async (): Promise<void> => {
    setState("working");
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await requestJson<unknown>(
        "DELETE",
        "/api/push/subscriptions",
        { endpoint: subscription.endpoint },
        "",
      );
      await subscription.unsubscribe();
    }
    setState("off");
  };

  if (state === "blocked") return <p className="text-ink-muted text-sm">{t("blocked")}</p>;
  return state === "on" ? (
    <Button variant="ghost" onClick={() => void turnOff()}>
      <BellOff aria-hidden className="size-5" />
      {t("off")}
    </Button>
  ) : (
    <Button variant="secondary" disabled={state === "working"} onClick={() => void turnOn()}>
      <Bell aria-hidden className="size-5" />
      {t("on")}
    </Button>
  );
}
