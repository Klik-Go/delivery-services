import { weekStarting } from "@klikgo/core";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { FinanceConsole } from "@/components/admin/finance-console";
import { OpsPage } from "@/components/admin/ops-page";

export const dynamic = "force-dynamic";

/** Payouts, cash riders hand in, and weekly reports (coordinators see cash only). */
export default async function AdminFinancePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const t = await getTranslations("Finance");
  const requested = (await searchParams).week;
  const week = typeof requested === "string" && weekStarting(requested) ? requested : null;
  return (
    <OpsPage path="/admin/finance" title={t("title")} lead={t("lead")}>
      {({ isAdmin }) => <FinanceConsole isAdmin={isAdmin} initialWeek={week} />}
    </OpsPage>
  );
}
