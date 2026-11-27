import { formatPeso, type StoreCard as StoreCardData } from "@klikgo/core";
import { Badge, PhotoFallback, Price, Sheet } from "@klikgo/ui";
import { Clock, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { JSX } from "react";
import { OpeningLabel } from "./opening-label";

/** Photo-first store tile: cover (or designed fallback), Inter name, mono fee. */
export function StoreCard({
  store,
  compact = false,
}: {
  readonly store: StoreCardData;
  readonly compact?: boolean;
}): JSX.Element {
  const t = useTranslations("Customer");
  return (
    <Sheet as="div" className={`overflow-hidden ${compact ? "w-60 shrink-0" : "w-full"}`}>
      <Link
        href={`/s/${store.slug}`}
        className="focus-visible:outline-action flex flex-col focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {/* A closed store's picture is greyed; the text keeps full contrast (WCAG 1.4.3). */}
        <div
          className={`bg-canvas relative aspect-[16/9] w-full ${store.opening.open ? "" : "grayscale"}`}
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
            <PhotoFallback name={store.name} />
          )}
          {store.freeDelivery ? (
            <Badge tone="turmeric" className="absolute top-2 left-2 font-semibold">
              {t("promoFree")}
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-col gap-1 px-3 py-3">
          <span className="text-body text-ink line-clamp-1 font-semibold">{store.name}</span>
          <span className="text-record text-ink-muted flex flex-wrap items-center gap-x-2">
            {store.ratingCount > 0 ? (
              <span className="inline-flex items-center gap-0.5">
                <Star aria-hidden className="text-awaiting size-3.5" fill="currentColor" />
                <span className="font-mono tabular-nums">
                  {t("rating", { rating: store.ratingAvg.toFixed(1), count: store.ratingCount })}
                </span>
              </span>
            ) : (
              <span>{t("new")}</span>
            )}
            <span className="inline-flex items-center gap-0.5">
              <Clock aria-hidden className="size-3.5" />
              <span className="font-mono tabular-nums">
                {t("eta", { min: store.eta.min, max: store.eta.max })}
              </span>
            </span>
            <Price value={formatPeso(store.deliveryFeeCentavos)} size="record" />
          </span>
          <OpeningLabel opening={store.opening} />
        </div>
      </Link>
    </Sheet>
  );
}
