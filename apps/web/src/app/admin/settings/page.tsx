import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { OpsPage } from "@/components/admin/ops-page";
import { SettingsAdmin } from "@/components/admin/settings-admin";

export const dynamic = "force-dynamic";

/** Feature flags and their settings (admins). */
export default async function AdminSettingsPage(): Promise<JSX.Element> {
  const [t, tSurfaces] = await Promise.all([
    getTranslations("Ops.settings"),
    getTranslations("Surfaces"),
  ]);
  return (
    <OpsPage path="/admin/settings" title={t("title")} lead={t("lead")}>
      {({ isAdmin }) =>
        isAdmin ? <SettingsAdmin /> : <p className="text-ink">{tSurfaces("forbiddenLead")}</p>
      }
    </OpsPage>
  );
}
