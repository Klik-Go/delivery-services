import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { StaffSignInForm } from "@/components/auth/staff-sign-in-form";
import { safeNextPath } from "@/server/http/safe-next";

/** Email + password sign-in for merchants, coordinators and admins. */
export default async function StaffSignInPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ next?: string; error?: string }>;
}): Promise<JSX.Element> {
  const t = await getTranslations("Auth");
  const { next, error } = await searchParams;
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-ink text-2xl font-bold">{t("staffTitle")}</h1>
        <p className="text-ink-muted">{t("staffLead")}</p>
      </header>
      <FormError message={error === "link" ? t("linkExpired") : null} />
      <StaffSignInForm next={next ? safeNextPath(next) : null} />
      <Link
        href="/auth/sign-in"
        className="text-brand-800 min-h-tap inline-flex items-center text-sm font-semibold underline"
      >
        {t("customerLink")}
      </Link>
    </>
  );
}
