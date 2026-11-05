import { formatPeso, type StoreCard as StoreCardData } from "@klikgo/core";
import { Clock, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { JSX } from "react";
import { OpeningLabel } from "./opening-label";

/** A store tile: cover, name, rating, arrival window, delivery fee, badges and closed state. */
export function StoreCard({
  store,
  compact = false,
}: {
  readonly store: StoreCardData;
  readonly compact?: boolean;
}): JSX.Element {
  const t = useTranslations("Customer");
  return (
    <Link
      href={`/s/${store.slug}`}
      className={`rounded-card focus-visible:outline-brand-600 border-brand-100 flex flex-col overflow-hidden border-2 bg-white ${compact ? "w-60 shrink-0" : "w-full"}`}
    >
      {/* A closed store's picture is greyed; the text keeps full contrast (WCAG 1.4.3). */}
      <div
        className={`bg-brand-100 relative aspect-[16/9] w-full ${store.opening.open ? "" : "grayscale"}`}
      >
        {store.coverUrl ? (
          <Image
            src={store.coverUrl}
            alt=""
            fill
            sizes="(max-width: 640px) 60vw, 240px"
            className="object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="font-display text-brand-800 absolute inset-0 grid place-items-center text-4xl"
          >
            {store.name.slice(0, 1)}
          </span>
        )}
        {store.freeDelivery ? (
          <span className="bg-accent-400 text-ink absolute top-2 left-2 rounded-full px-2 py-0.5 text-xs font-bold">
            {t("promoFree")}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1 p-3">
        <span className="text-ink line-clamp-1 font-bold">{store.name}</span>
        <span className="text-ink-muted flex flex-wrap items-center gap-x-2 text-sm">
          {store.ratingCount > 0 ? (
            <span className="inline-flex items-center gap-0.5">
              <Star aria-hidden className="text-accent-600 size-3.5" fill="currentColor" />
              {t("rating", { rating: store.ratingAvg.toFixed(1), count: store.ratingCount })}
            </span>
          ) : (
            <span>{t("new")}</span>
          )}
          <span className="inline-flex items-center gap-0.5">
            <Clock aria-hidden className="size-3.5" />
            {t("eta", { min: store.eta.min, max: store.eta.max })}
          </span>
          <span>{t("fee", { fee: formatPeso(store.deliveryFeeCentavos) })}</span>
        </span>
        <OpeningLabel opening={store.opening} />
      </div>
    </Link>
  );
}
