import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import type { JSX } from "react";
import { MfaEnroll, MfaVerifyForm } from "@/components/auth/mfa-forms";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { safeNextPath } from "@/server/http/safe-next";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

/** Second factor: enrol an authenticator app the first time, otherwise enter its code. */
export default async function MfaPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ next?: string }>;
}): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect("/auth/staff");
  const { next } = await searchParams;
  const nextPath = next ? safeNextPath(next) : null;
  const container = getContainer();
  const status = await container.forRequest(await createSupabaseServerClient()).mfa.status();
  if (status.ok && status.value.aal === "aal2")
    redirect(nextPath ?? container.authz.landingPath(user));

  const t = await getTranslations("Auth");
  const enrolled = status.ok && status.value.verifiedFactorId !== null;
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-ink text-2xl font-bold">
          {enrolled ? t("mfaVerifyTitle") : t("mfaEnrollTitle")}
        </h1>
        <p className="text-ink-muted">{enrolled ? t("mfaVerifyLead") : t("mfaEnrollLead")}</p>
      </header>
      {enrolled ? <MfaVerifyForm next={nextPath} /> : <MfaEnroll next={nextPath} />}
    </>
  );
}
