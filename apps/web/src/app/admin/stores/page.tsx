import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { OpsPage } from "@/components/admin/ops-page";
import { StoresAdmin } from "@/components/admin/stores-admin";

export const dynamic = "force-dynamic";

/** Live stores: status and commission. */
export default async function AdminStoresPage(): Promise<JSX.Element> {
  const t = await getTranslations("Ops.stores");
  return (
    <OpsPage path="/admin/stores" title={t("title")} lead={t("lead")}>
      {({ isAdmin }) => <StoresAdmin isAdmin={isAdmin} />}
    </OpsPage>
  );
}
