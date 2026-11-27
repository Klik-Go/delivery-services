import { formatPeso, type FeaturedPromo } from "@klikgo/core";
import { Button, EmptyState, Sheet, SheetSection } from "@klikgo/ui";
import { MapPin, Search, ShoppingBag, Ticket } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { StoreCard } from "@/components/customer/store-card";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { LegalFooter } from "@/components/hardening/legal-footer";
import { FunnelStep } from "@/components/hardening/telemetry";
import { readDeliveryLocation } from "@/server/customer/location";

/** Customer home: address chip, search, categories, featured promos and store rails. */
export default async function HomePage(): Promise<JSX.Element> {
  const [t, tCart, tHome, tPabili, user, location, pabili] = await Promise.all([
    getTranslations("Customer"),
    getTranslations("Customer.cart"),
    getTranslations("Home"),
    getTranslations("Pabili.home"),
    getSessionUser(),
    readDeliveryLocation(),
    getContainer().pabili.options(),
  ]);
  const feed = location
    ? await getContainer().feed.feed(location.location, user?.id ?? null)
    : null;

  return (
    <div className="mx-auto flex w-full max-w-screen-lg flex-col gap-5 px-4 pt-4 pb-6 lg:grid lg:grid-cols-[1fr_20rem] lg:items-start lg:gap-6">
      <FunnelStep name="home_viewed" />
      <div className="flex flex-col gap-5">
        <p className="text-body text-ink-muted">{tHome("tagline")}</p>
        <Link
          href="/address"
          className="border-rule bg-sheet text-body hover:bg-sheet-alt min-h-tap rounded-control shadow-panel flex items-center gap-2 self-start border px-3"
        >
          <MapPin aria-hidden className="text-action size-4" />
          {location ? (
            <>
              <span className="text-ink-muted">{t("deliverTo")}</span>
              <span className="text-ink max-w-48 truncate font-semibold">
                {location.label ?? t("currentLocation")}
              </span>
              <span className="text-action font-semibold">{t("changeAddress")}</span>
            </>
          ) : (
            <span className="text-action font-semibold">{t("setAddress")}</span>
          )}
        </Link>

        {!location ? (
          <Sheet>
            <SheetSection first className="bg-action text-white">
              <h1 className="text-document">{t("welcomeTitle")}</h1>
              <p className="text-body mt-2 text-white">{t("welcomeLead")}</p>
              <Button asChild variant="secondary" className="mt-4 border-0">
                <Link href="/address">
                  <MapPin aria-hidden className="size-5" />
                  {t("setAddress")}
                </Link>
              </Button>
            </SheetSection>
          </Sheet>
        ) : !feed?.zone ? (
          <EmptyState
            title={t("notInArea")}
            action={
              <Button asChild>
                <Link href="/address?waitlist=1">{t("joinWaitlist")}</Link>
              </Button>
            }
          />
        ) : (
          <>
            <Link
              href="/search"
              className="border-rule-strong bg-sheet text-ink-muted min-h-tap rounded-control flex items-center gap-2 border px-3 shadow-sm"
            >
              <Search aria-hidden className="size-5" />
              {t("searchPlaceholder")}
            </Link>
            {pabili.enabled ? (
              <Link
                href="/pabili"
                className="bg-accent text-ink rounded-panel min-h-tap shadow-panel flex items-center gap-3 px-4 py-3"
                data-testid="pabili-entry"
              >
                <ShoppingBag aria-hidden className="size-7 shrink-0" />
                <span className="flex flex-col">
                  <span className="text-title">{tPabili("title")}</span>
                  <span className="text-record">{tPabili("lead")}</span>
                </span>
              </Link>
            ) : null}
            {feed.categories.length > 1 ? (
              <nav
                aria-label={t("search.category")}
                className="-mx-4 flex gap-2 overflow-x-auto px-4"
              >
                {feed.categories.map((category) => (
                  <Link
                    key={category}
                    href={`/search?category=${category}`}
                    className="bg-sheet text-ink border-rule min-h-tap rounded-control text-body shadow-panel inline-flex shrink-0 items-center border px-3 font-medium"
                  >
                    {t(`categories.${category}`)}
                  </Link>
                ))}
              </nav>
            ) : null}
            {feed.promos.length > 0 ? (
              <section aria-labelledby="promos-heading" className="flex flex-col gap-2">
                <h2 id="promos-heading" className="text-title text-ink">
                  {t("promos")}
                </h2>
                <ul
                  tabIndex={0}
                  aria-labelledby="promos-heading"
                  className="focus-visible:outline-action -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1"
                >
                  {feed.promos.map((promo) => (
                    <li
                      key={promo.code}
                      className="bg-accent text-ink rounded-panel shadow-panel flex w-64 shrink-0 snap-start flex-col gap-1 p-4"
                    >
                      <span className="text-title flex items-center gap-2">
                        <Ticket aria-hidden className="size-5" />
                        {promoTitle(promo, t)}
                      </span>
                      {promo.minSubtotalCentavos > 0 ? (
                        <span className="text-record">
                          {t("promoMin", { amount: formatPeso(promo.minSubtotalCentavos) })}
                        </span>
                      ) : null}
                      <span className="text-record font-semibold">
                        {t("useCode", { code: promo.code })}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {feed.rails.length === 0 ? <EmptyState title={t("noStores")} /> : null}
            {feed.rails.map((rail) => (
              <section
                key={rail.key}
                aria-labelledby={`rail-${rail.key}`}
                className="flex flex-col gap-2"
              >
                <h2 id={`rail-${rail.key}`} className="text-title text-ink">
                  {t(`rails.${rail.key}`)}
                </h2>
                <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 lg:grid lg:grid-cols-2 lg:overflow-visible lg:px-0">
                  {rail.stores.map((store) => (
                    <li key={store.merchantId} className="snap-start lg:snap-none">
                      <StoreCard store={store} compact />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
        <LegalFooter signedIn={user !== null} />
      </div>
      <aside className="border-rule bg-sheet rounded-panel shadow-panel sticky top-4 hidden border p-4 lg:block">
        <p className="text-title text-ink">{tCart("title")}</p>
        <p className="text-record text-ink-muted mt-1">{tCart("empty")}</p>
        <Button asChild variant="secondary" className="mt-4 w-full">
          <Link href="/cart">{tCart("browse")}</Link>
        </Button>
      </aside>
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
