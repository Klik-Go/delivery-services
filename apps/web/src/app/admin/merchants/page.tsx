import { formatManilaDateTime } from "@klikgo/core";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { ApplicationReview } from "@/components/admin/application-review";
import { FormError } from "@/components/auth/form-error";
import { ConsoleNav } from "@/components/admin/console-nav";
import { SurfaceShell } from "@/components/surface-shell";
import { requireSurface } from "@/server/auth/guards";
import { getContainer } from "@/server/container";

export const dynamic = "force-dynamic";

/** Admins (and coordinators, read-only for their zone) review partner applications. */
export default async function AdminMerchantsPage(): Promise<JSX.Element> {
  const user = await requireSurface("admin", "/admin/merchants");
  const t = await getTranslations("AdminMerchants");
  const service = getContainer().merchantOnboarding();
  const applications = service.ok
    ? await service.value.listApplications(user)
    : { ok: false as const, error: service.error };
  const canReview = getContainer().authz.can(user, { type: "merchant.applications.review" });

  return (
    <SurfaceShell title={t("title")} lead={t("lead")} who={user.email ?? user.id}>
      <ConsoleNav isAdmin={getContainer().authz.can(user, { type: "ops.platform" })} />
      {!applications.ok ? (
        <FormError message={applications.error.message} />
      ) : applications.value.length === 0 ? (
        <p className="text-ink-muted">{t("empty")}</p>
      ) : (
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
              <article key={application.id} className="bg-surface-muted rounded-card p-4">
                <h2 className="text-ink text-xl font-bold">{application.businessName}</h2>
                <p className="text-ink-muted text-sm">
                  {application.barangay}, {application.city} · {application.zoneName}
                </p>
              </article>
            ),
          )}
        </div>
      )}
    </SurfaceShell>
  );
}
