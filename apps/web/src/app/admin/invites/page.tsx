import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { OpsPage } from "@/components/admin/ops-page";
import { InvitesConsole } from "@/components/pilot/invites-console";

export const dynamic = "force-dynamic";

/** Invite codes for the invite-only pilot (admins). */
export default async function AdminInvitesPage(): Promise<JSX.Element> {
  const t = await getTranslations("Pilot.invites");
  return (
    <OpsPage path="/admin/invites" title={t("title")} lead={t("lead")}>
      {() => <InvitesConsole />}
    </OpsPage>
  );
}
