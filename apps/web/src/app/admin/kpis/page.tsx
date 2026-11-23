import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { OpsPage } from "@/components/admin/ops-page";
import { KpiDashboard } from "@/components/pilot/kpi-dashboard";

export const dynamic = "force-dynamic";

/** The pilot's KPIs for the daily review (admins). */
export default async function AdminKpisPage(): Promise<JSX.Element> {
  const t = await getTranslations("Pilot.kpis");
  return (
    <OpsPage path="/admin/kpis" title={t("title")} lead={t("lead")}>
      {() => <KpiDashboard />}
    </OpsPage>
  );
}
