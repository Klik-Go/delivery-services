import { Button } from "@klikgo/ui";
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
        <h1 className="text-document text-ink">{t("signInTitle")}</h1>
        <p className="text-body text-ink-muted">
          {getContainer().placeholderOtp ? t("signInLeadPlaceholder") : t("signInLead")}
        </p>
      </header>
      <PhoneSignInForm next={next ? safeNextPath(next) : null} />
      <Button asChild variant="ghost" className="self-start px-0">
        <Link href="/auth/staff">{t("staffLink")}</Link>
      </Button>
    </>
  );
}
