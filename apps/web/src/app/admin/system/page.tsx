import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { OpsPage } from "@/components/admin/ops-page";
import { SystemStatusView } from "@/components/hardening/system-status-view";

export const dynamic = "force-dynamic";

/** System status for admins: job lag, schedules, failing webhooks, missed deadlines. */
export default async function AdminSystemPage(): Promise<JSX.Element> {
  const t = await getTranslations("Hardening.system");
  return (
    <OpsPage path="/admin/system" title={t("title")} lead={t("lead")}>
      {() => <SystemStatusView />}
    </OpsPage>
  );
}
