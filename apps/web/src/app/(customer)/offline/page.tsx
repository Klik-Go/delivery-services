import { BrandLogo, EmptyState } from "@klikgo/ui";
import { WifiOff } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";

/** Shown by the service worker when a page is opened offline and no saved copy exists. */
export default async function OfflinePage(): Promise<JSX.Element> {
  const t = await getTranslations("Customer");
  return (
    <main className="bg-canvas mx-auto flex min-h-dvh max-w-screen-sm flex-col items-center justify-center gap-4 px-4 text-center">
      <BrandLogo size={56} decorative />
      <EmptyState
        className="w-full items-center text-center"
        title={t("offlineTitle")}
        description={t("offlineLead")}
        action={
          <>
            <WifiOff aria-hidden className="text-ink-muted mx-auto mb-2 size-8" />
            {/* Full document navigation retries the network; client Link would stay offline. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- intentional hard navigation */}
            <a
              href="/"
              className="bg-action hover:bg-action-hover shadow-panel inline-flex h-11 min-w-11 items-center justify-center rounded-md px-4 text-sm font-medium text-white"
            >
              {t("retry")}
            </a>
          </>
        }
      />
    </main>
  );
}
