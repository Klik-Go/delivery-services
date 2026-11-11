import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { RiderApplication } from "@/components/rider/rider-application";
import { getInviteOptions } from "@/server/admin/invite-options";
import { getSessionUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

/** Apply to ride and upload the onboarding documents (docs/BUSINESS.md Appendix B). */
export default async function BecomeARiderPage(): Promise<JSX.Element> {
  const [t, user, { zones }] = await Promise.all([
    getTranslations("RiderApply"),
    getSessionUser(),
    getInviteOptions(),
  ]);
  return (
    <main className="mx-auto flex w-full max-w-screen-sm flex-col gap-4 px-4 py-6">
      <h1 className="text-ink text-2xl font-bold">{t("title")}</h1>
      <p className="text-ink-muted">{t("lead")}</p>
      {user ? (
        <RiderApplication zones={zones} />
      ) : (
        <Link
          href="/auth/sign-in?next=/become-a-rider"
          className="text-brand-800 font-semibold underline"
        >
          {t("signIn")}
        </Link>
      )}
    </main>
  );
}
