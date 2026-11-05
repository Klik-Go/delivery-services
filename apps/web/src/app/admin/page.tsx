import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { InviteStaffForm } from "@/components/admin/invite-staff-form";
import { SurfaceShell } from "@/components/surface-shell";
import { getInviteOptions } from "@/server/admin/invite-options";
import { requireSurface } from "@/server/auth/guards";
import { getContainer } from "@/server/container";

/** Admin console placeholder with staff invitations (full console: Phase 8). */
export default async function AdminPage(): Promise<JSX.Element> {
  const user = await requireSurface("admin", "/admin");
  const [t, tAdmin, tMerchants] = await Promise.all([
    getTranslations("Surfaces"),
    getTranslations("Admin"),
    getTranslations("AdminMerchants"),
  ]);
  const canInvite = getContainer().authz.can(user, { type: "staff.invite" });
  const options = canInvite ? await getInviteOptions() : null;
  return (
    <SurfaceShell title={t("adminTitle")} lead={t("adminLead")} who={user.email ?? user.id}>
      <Link
        href="/admin/merchants"
        className="bg-brand-800 min-h-tap inline-flex items-center self-start rounded-full px-5 font-semibold text-white"
      >
        {tMerchants("link")}
      </Link>
      {options ? (
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
      ) : null}
    </SurfaceShell>
  );
}
