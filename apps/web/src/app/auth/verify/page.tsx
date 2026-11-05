import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { JSX } from "react";
import { OtpVerifyForm } from "@/components/auth/otp-verify-form";
import { safeNextPath } from "@/server/http/safe-next";

/** Enter the texted code. */
export default async function VerifyPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ phone?: string; next?: string }>;
}): Promise<JSX.Element> {
  const t = await getTranslations("Auth");
  const { phone, next } = await searchParams;
  if (!phone || !/^\+639\d{9}$/.test(phone)) redirect("/auth/sign-in");
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-ink text-2xl font-bold">{t("verifyTitle")}</h1>
        <p className="text-ink-muted">{t("verifyLead", { phone })}</p>
      </header>
      <OtpVerifyForm phone={phone} next={next ? safeNextPath(next) : null} />
      <Link
        href="/auth/sign-in"
        className="text-brand-800 min-h-tap inline-flex items-center text-sm font-semibold underline"
      >
        {t("changeNumber")}
      </Link>
    </>
  );
}
