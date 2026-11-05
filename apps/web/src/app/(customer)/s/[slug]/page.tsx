import { formatPeso } from "@klikgo/core";
import { Banknote, ChevronLeft, Clock, MapPin, Star } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { OpeningLabel } from "@/components/customer/opening-label";
import { StoreMenu } from "@/components/customer/store-menu";
import { getContainer } from "@/server/container";
import { readDeliveryLocation } from "@/server/customer/location";

type Params = { params: Promise<{ slug: string }> };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

async function load(slug: string) {
  if (!SLUG.test(slug) || slug.length > 80) return null;
  const result = await getContainer().storefront.store(slug);
  return result.ok ? result.value : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const data = await load((await params).slug);
  return data ? { title: data.store.name, description: data.store.description ?? undefined } : {};
}

/** Store page: hero, info strip (arrival, fee, rating), sticky category tabs and the item sheet. */
export default async function StorePage({ params }: Params): Promise<JSX.Element> {
  const data = await load((await params).slug);
  if (!data) notFound();
  const [t, location] = await Promise.all([getTranslations("Customer"), readDeliveryLocation()]);
  const { store, menu } = data;
  const card = location
    ? (await getContainer().feed.feed(location.location, null)).stores.find(
        (s) => s.merchantId === store.merchantId,
      )
    : undefined;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-screen-md flex-col gap-4 px-4 pt-4">
      <Link
        href="/"
        className="text-brand-800 min-h-tap inline-flex items-center gap-1 self-start font-semibold"
      >
        <ChevronLeft aria-hidden className="size-5" />
        Klik Go
      </Link>
      <div className="rounded-card bg-brand-800 relative aspect-[16/7] w-full overflow-hidden">
        {card?.coverUrl ? (
          <Image
            src={card.coverUrl}
            alt=""
            fill
            priority
            sizes="(max-width: 768px) 100vw, 768px"
            className="object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="font-display text-accent-400 absolute inset-0 grid place-items-center text-6xl"
          >
            {store.name.slice(0, 1)}
          </span>
        )}
      </div>
      <header className="flex flex-col gap-2">
        <h1 className="text-ink text-3xl font-bold">{store.name}</h1>
        {store.description ? <p className="text-ink-muted">{store.description}</p> : null}
        <ul className="text-ink flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Store info">
          {card ? (
            <>
              <li className="inline-flex items-center gap-1">
                <Clock aria-hidden className="size-4" />
                {t("eta", { min: card.eta.min, max: card.eta.max })}
              </li>
              <li className="inline-flex items-center gap-1">
                <MapPin aria-hidden className="size-4" />
                {t("fee", { fee: formatPeso(card.deliveryFeeCentavos) })}
              </li>
              {card.ratingCount > 0 ? (
                <li className="inline-flex items-center gap-1">
                  <Star aria-hidden className="text-accent-600 size-4" fill="currentColor" />
                  {t("rating", { rating: card.ratingAvg.toFixed(1), count: card.ratingCount })}
                </li>
              ) : null}
            </>
          ) : (
            <li className="inline-flex items-center gap-1">
              <Clock aria-hidden className="size-4" />
              {t("store.prep", { minutes: store.defaultPrepMinutes })}
            </li>
          )}
          {store.acceptsCod ? (
            <li className="inline-flex items-center gap-1">
              <Banknote aria-hidden className="size-4" />
              {t("store.cod")}
            </li>
          ) : null}
        </ul>
        {card ? <OpeningLabel opening={card.opening} /> : null}
        {card && !card.opening.open ? (
          <p className="text-ink-muted text-sm">{t("store.closedNotice")}</p>
        ) : null}
      </header>
      <StoreMenu
        store={{ merchantId: store.merchantId, name: store.name, slug: store.slug }}
        categories={menu.map((category) => ({
          id: category.id,
          name: category.name,
          items: category.items.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            priceCentavos: item.priceCentavos,
            isAvailable: item.isAvailable,
            photoUrl: item.photoUrl,
            modifierGroups: item.modifierGroups,
          })),
        }))}
      />
    </main>
  );
}
