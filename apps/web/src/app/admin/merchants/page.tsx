import { formatManilaDateTime, type SessionUser } from "@klikgo/core";
import { Sheet, SheetSection } from "@klikgo/ui";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { ApplicationReview } from "@/components/admin/application-review";
import { OpsPage } from "@/components/admin/ops-page";
import { FormError } from "@/components/auth/form-error";
import { getContainer } from "@/server/container";

export const dynamic = "force-dynamic";

/** Admins (and coordinators, read-only for their zone) review partner applications. */
export default async function AdminMerchantsPage(): Promise<JSX.Element> {
  const t = await getTranslations("AdminMerchants");
  return (
    <OpsPage path="/admin/merchants" title={t("title")} lead={t("lead")}>
      {({ user }) => <MerchantsBody user={user} />}
    </OpsPage>
  );
}

async function MerchantsBody({ user }: { readonly user: SessionUser }): Promise<JSX.Element> {
  const t = await getTranslations("AdminMerchants");
  const service = getContainer().merchantOnboarding();
  const applications = service.ok
    ? await service.value.listApplications(user)
    : { ok: false as const, error: service.error };
  const canReview = getContainer().authz.can(user, { type: "merchant.applications.review" });

  if (!applications.ok) return <FormError message={applications.error.message} />;
  if (applications.value.length === 0) {
    return <p className="text-body text-ink-muted">{t("empty")}</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {applications.value.map((application) =>
        canReview ? (
          <ApplicationReview
            key={application.id}
            application={{
              id: application.id,
              businessName: application.businessName,
              ownerName: application.ownerName,
              phone: application.phone,
              email: application.email,
              barangay: application.barangay,
              city: application.city,
              zoneName: application.zoneName,
              receivedAt: formatManilaDateTime(application.createdAt),
            }}
          />
        ) : (
          <Sheet key={application.id}>
            <SheetSection first>
              <h2 className="text-title text-ink">{application.businessName}</h2>
              <p className="text-record text-ink-muted">
                {application.barangay}, {application.city} · {application.zoneName}
              </p>
            </SheetSection>
          </Sheet>
        ),
      )}
    </div>
  );
}
