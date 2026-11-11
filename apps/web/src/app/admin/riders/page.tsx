import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { OpsPage } from "@/components/admin/ops-page";
import { RiderReviewQueue } from "@/components/admin/rider-review";

export const dynamic = "force-dynamic";

/** Rider KYC queue, active and suspended riders, and the coaching list. */
export default async function AdminRidersPage(): Promise<JSX.Element> {
  const t = await getTranslations("Ops.riders");
  return (
    <OpsPage path="/admin/riders" title={t("title")} lead={t("lead")}>
      {() => <RiderReviewQueue />}
    </OpsPage>
  );
}
