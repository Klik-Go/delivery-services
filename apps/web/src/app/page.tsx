import { BrandLogo } from "@klikgo/ui";
import { Bike, HeartHandshake, MapPin, Receipt } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";

const VALUES = [
  { key: "speed", Icon: Bike },
  { key: "reliability", Icon: Receipt },
  { key: "community", Icon: HeartHandshake },
] as const;

/** Customer landing page. Phase 4 replaces it with the discovery feed. */
export default async function HomePage(): Promise<JSX.Element> {
  const t = await getTranslations("Home");
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col px-4 pt-6 pb-6">
      <main className="flex flex-1 flex-col gap-8">
        {/* Hero on brand-800: white text 5.0:1, yellow wordmark 3.5:1 as large display text. */}
        <header className="bg-brand-800 rounded-card flex flex-col items-start gap-4 p-6 text-white">
          <div className="flex items-center gap-4">
            <BrandLogo size={72} />
            <h1 className="font-display text-accent-400 text-5xl leading-none tracking-wide">
              {t("brand")}
            </h1>
          </div>
          <p className="text-2xl leading-snug font-semibold">{t("tagline")}</p>
          <p className="text-base leading-relaxed">{t("intro")}</p>
          <p className="bg-accent-400 text-ink min-h-tap inline-flex items-center gap-2 rounded-full px-4 text-sm font-semibold">
            <MapPin aria-hidden="true" className="size-4" />
            {t("status")}
          </p>
        </header>

        <section aria-labelledby="values-heading" className="flex flex-col gap-3">
          <h2 id="values-heading" className="font-display text-brand-800 text-2xl tracking-wide">
            {t("valuesHeading")}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-3">
            {VALUES.map(({ key, Icon }) => (
              <li key={key} className="bg-surface-muted rounded-card flex gap-3 p-4 sm:flex-col">
                <span className="bg-accent-400 text-ink inline-flex size-10 shrink-0 items-center justify-center rounded-full">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <div>
                  <h3 className="text-ink font-semibold">{t(`values.${key}.title`)}</h3>
                  <p className="text-ink-muted text-sm">{t(`values.${key}.body`)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <footer className="text-ink-muted pt-8 text-center text-sm">{t("footer")}</footer>
    </div>
  );
}
