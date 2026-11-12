import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { InviteStaffForm } from "@/components/admin/invite-staff-form";
import { OpsPage } from "@/components/admin/ops-page";
import { StaffAdmin } from "@/components/admin/staff-admin";
import { getInviteOptions } from "@/server/admin/invite-options";

export const dynamic = "force-dynamic";

/** Staff: invite new staff and remove access (admins). */
export default async function AdminStaffPage(): Promise<JSX.Element> {
  const [t, tAdmin, tSurfaces] = await Promise.all([
    getTranslations("Ops.staff"),
    getTranslations("Admin"),
    getTranslations("Surfaces"),
  ]);
  const options = await getInviteOptions();
  return (
    <OpsPage path="/admin/staff" title={t("title")} lead={t("lead")}>
      {({ isAdmin }) =>
        isAdmin ? (
          <>
            <section
              aria-labelledby="invite-heading"
              className="bg-surface-muted rounded-card flex flex-col gap-3 p-4"
            >
              <h2 id="invite-heading" className="text-ink text-xl font-bold">
                {tAdmin("inviteTitle")}
              </h2>
              <p className="text-ink-muted text-sm">{tAdmin("inviteLead")}</p>
              <InviteStaffForm merchants={options.merchants} zones={options.zones} />
            </section>
            <StaffAdmin />
          </>
        ) : (
          <p className="text-ink">{tSurfaces("forbiddenLead")}</p>
        )
      }
    </OpsPage>
  );
}
