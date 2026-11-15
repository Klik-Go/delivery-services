import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { OpsPage } from "@/components/admin/ops-page";
import { PromoAdmin } from "@/components/admin/promo-admin";

export const dynamic = "force-dynamic";

/** Promo campaigns with caps, budgets and eligibility (admins). */
export default async function AdminPromosPage(): Promise<JSX.Element> {
  const [t, tSurfaces] = await Promise.all([
    getTranslations("Retention.promos"),
    getTranslations("Surfaces"),
  ]);
  return (
    <OpsPage path="/admin/promos" title={t("title")} lead={t("lead")}>
      {({ isAdmin }) =>
        isAdmin ? <PromoAdmin /> : <p className="text-ink">{tSurfaces("forbiddenLead")}</p>
      }
    </OpsPage>
  );
}
