import { formatPeso, type FeaturedPromo } from "@klikgo/core";
import { BrandLogo } from "@klikgo/ui";
import { MapPin, Search, Ticket } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { StoreCard } from "@/components/customer/store-card";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { readDeliveryLocation } from "@/server/customer/location";

/** Customer home: "Deliver to", search, categories, featured promos and store rails. */
export default async function HomePage(): Promise<JSX.Element> {
  const [t, tHome, user, location] = await Promise.all([
    getTranslations("Customer"),
    getTranslations("Home"),
    getSessionUser(),
    readDeliveryLocation(),
  ]);
  const feed = location
    ? await getContainer().feed.feed(location.location, user?.id ?? null)
    : null;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-screen-md flex-col gap-5 px-4 pt-4 pb-10">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BrandLogo size={40} />
          <h1 className="font-display text-brand-800 text-3xl leading-none tracking-wide">
            {tHome("brand")}
          </h1>
        </div>
        <nav aria-label="Account" className="flex items-center gap-2">
          {user ? (
            <SignOutButton label={tHome("signOut")} />
          ) : (
            <Link
              href="/auth/sign-in"
              className="text-brand-800 min-h-tap inline-flex items-center px-2 font-semibold underline"
            >
              {tHome("signIn")}
            </Link>
          )}
        </nav>
      </header>
      <p className="text-ink-muted -mt-3 text-sm">{tHome("tagline")}</p>
      {user ? (
        <p className="text-ink-muted -mt-3 truncate text-sm">
          {tHome("signedInAs", { who: user.phone ?? user.email ?? "" })}
        </p>
      ) : null}

      <Link
        href="/address"
        className="bg-surface-muted min-h-tap flex items-center gap-2 self-start rounded-full px-4 text-sm"
      >
        <MapPin aria-hidden className="text-brand-800 size-4" />
        {location ? (
          <>
            <span className="text-ink-muted">{t("deliverTo")}</span>
            <span className="text-ink max-w-48 truncate font-semibold">
              {location.label ?? t("currentLocation")}
            </span>
            <span className="text-brand-800 font-semibold">{t("changeAddress")}</span>
          </>
        ) : (
          <span className="text-brand-800 font-semibold">{t("setAddress")}</span>
        )}
      </Link>

      {!location ? (
        <section className="bg-brand-800 rounded-card flex flex-col items-start gap-3 p-6 text-white">
          <h2 className="text-2xl font-bold">{t("welcomeTitle")}</h2>
          <p>{t("welcomeLead")}</p>
          <Link
            href="/address"
            className="bg-accent-400 text-ink min-h-tap inline-flex items-center gap-2 rounded-full px-5 font-semibold"
          >
            <MapPin aria-hidden className="size-5" />
            {t("setAddress")}
          </Link>
        </section>
      ) : !feed?.zone ? (
        <section className="bg-surface-muted rounded-card flex flex-col items-start gap-3 p-6">
          <p className="text-ink text-lg font-bold">{t("notInArea")}</p>
          <Link
            href="/address?waitlist=1"
            className="bg-brand-800 min-h-tap inline-flex items-center rounded-full px-5 font-semibold text-white"
          >
            {t("joinWaitlist")}
          </Link>
        </section>
      ) : (
        <>
          <Link
            href="/search"
            className="border-ink-muted/40 text-ink-muted min-h-tap flex items-center gap-2 rounded-full border-2 px-4"
          >
            <Search aria-hidden className="size-5" />
            {t("searchPlaceholder")}
          </Link>
          {feed.categories.length > 1 ? (
            <nav
              aria-label={t("search.category")}
              className="-mx-4 flex gap-2 overflow-x-auto px-4"
            >
              {feed.categories.map((category) => (
                <Link
                  key={category}
                  href={`/search?category=${category}`}
                  className="bg-surface-muted text-ink min-h-tap inline-flex shrink-0 items-center rounded-full px-4 text-sm font-semibold"
                >
                  {t(`categories.${category}`)}
                </Link>
              ))}
            </nav>
          ) : null}
          {feed.promos.length > 0 ? (
            <section aria-labelledby="promos-heading" className="flex flex-col gap-2">
              <h2 id="promos-heading" className="text-ink text-xl font-bold">
                {t("promos")}
              </h2>
              {/* Promo cards hold no links, so the scroller itself takes focus for arrow keys. */}
              <ul
                tabIndex={0}
                aria-labelledby="promos-heading"
                className="focus-visible:outline-brand-600 -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1"
              >
                {feed.promos.map((promo) => (
                  <li
                    key={promo.code}
                    className="bg-accent-400 text-ink rounded-card flex w-64 shrink-0 snap-start flex-col gap-1 p-4"
                  >
                    <span className="flex items-center gap-2 text-lg font-bold">
                      <Ticket aria-hidden className="size-5" />
                      {promoTitle(promo, t)}
                    </span>
                    {promo.minSubtotalCentavos > 0 ? (
                      <span className="text-sm">
                        {t("promoMin", { amount: formatPeso(promo.minSubtotalCentavos) })}
                      </span>
                    ) : null}
                    <span className="text-sm font-semibold">
                      {t("useCode", { code: promo.code })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {feed.rails.length === 0 ? <p className="text-ink-muted">{t("noStores")}</p> : null}
          {feed.rails.map((rail) => (
            <section
              key={rail.key}
              aria-labelledby={`rail-${rail.key}`}
              className="flex flex-col gap-2"
            >
              <h2 id={`rail-${rail.key}`} className="text-ink text-xl font-bold">
                {t(`rails.${rail.key}`)}
              </h2>
              <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
                {rail.stores.map((store) => (
                  <li key={store.merchantId} className="snap-start">
                    <StoreCard store={store} compact />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function promoTitle(
  promo: FeaturedPromo,
  t: Awaited<ReturnType<typeof getTranslations<"Customer">>>,
): string {
  if (promo.type === "free_delivery") return t("promoFree");
  if (promo.type === "percent_off")
    return t("promoPercent", { percent: (promo.discountBps ?? 0) / 100 });
  return t("promoFixed", { amount: formatPeso(promo.discountCentavos ?? 0).replace("₱", "") });
}
