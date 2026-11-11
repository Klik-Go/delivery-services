import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { OpsPage } from "@/components/admin/ops-page";
import { ZoneEditor } from "@/components/admin/zone-editor";

export const dynamic = "force-dynamic";

/** Zones: outline, fees, radius, status and coordinator (admins edit; coordinators look). */
export default async function AdminZonesPage(): Promise<JSX.Element> {
  const t = await getTranslations("Ops.zones");
  return (
    <OpsPage path="/admin/zones" title={t("title")} lead={t("lead")}>
      {({ isAdmin }) => <ZoneEditor isAdmin={isAdmin} />}
    </OpsPage>
  );
}
