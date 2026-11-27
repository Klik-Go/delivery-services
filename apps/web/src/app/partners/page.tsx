import { BrandLogo, Masthead, Sheet, SheetSection, SkipLink } from "@klikgo/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { PartnerApplicationForm } from "@/components/partners/partner-application-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Partners");
  return { title: t("title") };
}

/** Public page: stores apply to join Klik Go (approved by an admin in /admin/merchants). */
export default async function PartnersPage(): Promise<JSX.Element> {
  const t = await getTranslations("Partners");
  return (
    <div className="bg-canvas min-h-dvh">
      <SkipLink label="Skip to content" />
      <Masthead
        density="compact"
        brand={
          <Link href="/" className="flex items-center gap-2">
            <BrandLogo size={36} decorative />
            <span className="font-display text-accent text-2xl tracking-wide">Klik Go</span>
          </Link>
        }
        title={t("title")}
      />
      <main id="main" className="mx-auto flex w-full max-w-screen-sm flex-col gap-4 px-4 py-6">
        <Sheet>
          <SheetSection first>
            <h1 className="text-document text-ink">{t("title")}</h1>
            <p className="text-lede text-ink-muted mt-2">{t("lead")}</p>
          </SheetSection>
        </Sheet>
        <PartnerApplicationForm />
      </main>
    </div>
  );
}
