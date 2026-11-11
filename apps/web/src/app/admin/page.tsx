import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { OpsBoard } from "@/components/admin/ops-board";
import { OpsPage } from "@/components/admin/ops-page";
import { getInviteOptions } from "@/server/admin/invite-options";
import { getContainer } from "@/server/container";

export const dynamic = "force-dynamic";

/** The console's home: live orders with SLA colours and the map of riders and orders. */
export default async function AdminPage(): Promise<JSX.Element> {
  const t = await getTranslations("Ops.board");
  const { zones } = await getInviteOptions();
  return (
    <OpsPage path="/admin" title={t("title")} lead={t("lead")}>
      {({ user, isAdmin }) => {
        const mine = isAdmin
          ? zones
          : zones.filter((zone) => getContainer().authz.zoneIdsOf(user).includes(zone.id));
        return <OpsBoard zones={mine} />;
      }}
    </OpsPage>
  );
}
