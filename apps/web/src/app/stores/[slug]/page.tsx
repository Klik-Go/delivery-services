import { formatPeso } from "@klikgo/core";
import { BrandLogo } from "@klikgo/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { getContainer } from "@/server/container";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

async function load(slug: string) {
  if (!SLUG.test(slug)) return null;
  const result = await getContainer().storefront.store(slug);
  return result.ok ? result.value : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const store = await load((await params).slug);
  return store
    ? { title: store.store.name, description: store.store.description ?? undefined }
    : {};
}

/**
 * A live store's public page (/stores/:slug): details and menu, read-only. The full store page with
 * cart and item sheet arrives in Phase 4.
 */
export default async function StorePage({ params }: Params): Promise<JSX.Element> {
  const data = await load((await params).slug);
  if (!data) notFound();
  const t = await getTranslations("Storefront");
  const { store, menu } = data;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-screen-md flex-col gap-6 px-4 py-6">
      <Link href="/" className="flex items-center gap-3 self-start">
        <BrandLogo size={36} decorative />
        <span className="font-display text-brand-800 text-xl tracking-wide">Klik Go</span>
      </Link>
      <header className="flex flex-col gap-2">
        <h1 className="text-ink text-3xl font-bold">{store.name}</h1>
        {store.description ? <p className="text-ink-muted">{store.description}</p> : null}
        <p className="flex flex-wrap gap-2 text-sm">
          <span
            className={`rounded-full px-3 py-1 font-semibold ${store.isOpen ? "bg-brand-800 text-white" : "bg-surface-muted text-ink"}`}
          >
            {store.isOpen ? t("open") : t("closed")}
          </span>
          <span className="bg-surface-muted text-ink rounded-full px-3 py-1">
            {t("prep", { minutes: store.defaultPrepMinutes })}
          </span>
          {store.acceptsCod ? (
            <span className="bg-surface-muted text-ink rounded-full px-3 py-1">{t("cod")}</span>
          ) : null}
        </p>
      </header>
      {menu.length === 0 ? <p className="text-ink-muted">{t("empty")}</p> : null}
      {menu.map((category) => (
        <section
          key={category.id}
          aria-labelledby={`c-${category.id}`}
          className="flex flex-col gap-3"
        >
          <h2 id={`c-${category.id}`} className="text-ink text-xl font-bold">
            {category.name}
          </h2>
          <ul className="flex flex-col gap-2">
            {category.items.map((item) => (
              <li
                key={item.id}
                className={`rounded-card border-brand-100 flex items-center gap-3 border-2 p-3 ${item.isAvailable ? "" : "opacity-60"}`}
              >
                {item.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- small WebP from Storage
                  <img
                    src={item.photoUrl}
                    alt=""
                    loading="lazy"
                    className="size-16 rounded-lg object-cover"
                  />
                ) : null}
                <div className="flex flex-1 flex-col">
                  <span className="text-ink font-semibold">{item.name}</span>
                  {item.description ? (
                    <span className="text-ink-muted text-sm">{item.description}</span>
                  ) : null}
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-ink font-semibold">{formatPeso(item.priceCentavos)}</span>
                  {!item.isAvailable ? (
                    <span className="bg-accent-400 text-ink rounded-full px-2 text-xs font-bold">
                      {t("soldOut")}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
