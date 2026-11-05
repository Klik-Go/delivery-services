import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { JSX } from "react";
import { PhoneSignInForm } from "@/components/auth/phone-sign-in-form";
import { getContainer } from "@/server/container";
import { safeNextPath } from "@/server/http/safe-next";

/** Phone sign-in / sign-up for customers and riders. */
export default async function SignInPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ next?: string }>;
}): Promise<JSX.Element> {
  const t = await getTranslations("Auth");
  const { next } = await searchParams;
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-ink text-2xl font-bold">{t("signInTitle")}</h1>
        <p className="text-ink-muted">
          {getContainer().placeholderOtp ? t("signInLeadPlaceholder") : t("signInLead")}
        </p>
      </header>
      <PhoneSignInForm next={next ? safeNextPath(next) : null} />
      <Link
        href="/auth/staff"
        className="text-brand-800 min-h-tap inline-flex items-center text-sm font-semibold underline"
      >
        {t("staffLink")}
      </Link>
    </>
  );
}
