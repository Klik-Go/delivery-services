import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { PayoutsPanel } from "@/components/finance/payouts-panel";
import { SurfaceShell } from "@/components/surface-shell";
import { requireSurface } from "@/server/auth/guards";

/** The rider's payouts: where they are paid, unpaid earnings, cash held, weekly statements. */
export default async function RiderPayoutsPage(): Promise<JSX.Element> {
  const user = await requireSurface("rider", "/rider/payouts");
  const t = await getTranslations("Finance.statements");
  return (
    <SurfaceShell title={t("riderTitle")} lead={t("riderLead")} who={user.phone ?? user.id}>
      <Link href="/rider" className="text-brand-800 self-start font-semibold underline">
        ← {t("backToRider")}
      </Link>
      <PayoutsPanel base="/api/rider/payouts" kind="rider" />
    </SurfaceShell>
  );
}
