import { BrandLogo } from "@klikgo/ui";
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
    <main className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col gap-6 px-4 py-6">
      <Link href="/" className="flex items-center gap-3 self-start">
        <BrandLogo size={40} decorative />
        <span className="font-display text-brand-800 text-2xl tracking-wide">Klik Go</span>
      </Link>
      <header className="flex flex-col gap-2">
        <h1 className="text-ink text-3xl font-bold">{t("title")}</h1>
        <p className="text-ink-muted">{t("lead")}</p>
      </header>
      <PartnerApplicationForm />
    </main>
  );
}
