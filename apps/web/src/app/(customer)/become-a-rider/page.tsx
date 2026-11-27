import { Button, EmptyState, PhotoFallback, Sheet, SheetSection } from "@klikgo/ui";
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
    <main className="bg-canvas mx-auto flex w-full max-w-screen-sm flex-col gap-4 px-4 py-6">
      <Sheet className="overflow-hidden">
        <div className="aspect-[21/9]">
          <PhotoFallback name="Rider" />
        </div>
        <SheetSection>
          <h1 className="text-document text-ink">{t("title")}</h1>
          <p className="text-lede text-ink-muted mt-2">{t("lead")}</p>
        </SheetSection>
      </Sheet>
      {user ? (
        <RiderApplication zones={zones} />
      ) : (
        <EmptyState
          title={t("signIn")}
          description={t("lead")}
          action={
            <Button asChild>
              <Link href="/auth/sign-in?next=/become-a-rider">{t("signIn")}</Link>
            </Button>
          }
        />
      )}
    </main>
  );
}
