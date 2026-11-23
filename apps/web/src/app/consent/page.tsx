import { safeNext } from "@klikgo/core";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { BrandLogo } from "@klikgo/ui";
import { ConsentForm } from "@/components/hardening/consent-form";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Hardening.consent"))("title") };
}

/** Agreeing to the terms and privacy notice after sign-in (new accounts, or new versions). */
export default async function ConsentPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const requested = (await searchParams).next;
  const next = safeNext(typeof requested === "string" ? requested : "/");
  const user = await getSessionUser();
  if (!user) redirect(`/auth/sign-in?next=${encodeURIComponent(next)}`);
  if ((await getContainer().consents.missing(user.id)).length === 0) redirect(next);
  const t = await getTranslations("Hardening.consent");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col gap-4 px-4 py-6">
      <BrandLogo size={44} decorative />
      <h1 className="font-display text-ink text-3xl">{t("title")}</h1>
      <p className="text-ink">{t("lead")}</p>
      <ConsentForm next={next} />
    </main>
  );
}
