import { BrandLogo } from "@klikgo/ui";
import { WifiOff } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";

/** Shown by the service worker when a page is opened offline and no saved copy exists. */
export default async function OfflinePage(): Promise<JSX.Element> {
  const t = await getTranslations("Customer");
  return (
    <main className="mx-auto flex min-h-dvh max-w-screen-sm flex-col items-center justify-center gap-4 px-4 text-center">
      <BrandLogo size={56} decorative />
      <WifiOff aria-hidden className="text-ink-muted size-10" />
      <h1 className="text-ink text-2xl font-bold">{t("offlineTitle")}</h1>
      <p className="text-ink-muted">{t("offlineLead")}</p>
      {/* A full reload (not client navigation) is the point: it retries the network. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        className="bg-brand-800 min-h-tap inline-flex items-center rounded-full px-5 font-semibold text-white"
      >
        {t("retry")}
      </a>
    </main>
  );
}
