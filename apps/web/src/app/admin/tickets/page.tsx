import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { TicketQueue } from "@/components/admin/ticket-queue";
import { OpsPage } from "@/components/admin/ops-page";

export const dynamic = "force-dynamic";

/** Low ratings to follow up (docs/BUSINESS.md §5.3): the coordinator's zones only. */
export default async function AdminTicketsPage(): Promise<JSX.Element> {
  const t = await getTranslations("Retention.tickets");
  return (
    <OpsPage path="/admin/tickets" title={t("title")} lead={t("lead")}>
      {() => <TicketQueue />}
    </OpsPage>
  );
}
