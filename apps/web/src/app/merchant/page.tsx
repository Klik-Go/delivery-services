import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { SurfaceShell } from "@/components/surface-shell";
import { requireSurface } from "@/server/auth/guards";

/** Merchant dashboard placeholder (order board: Phase 6, menu manager: Phase 3). */
export default async function MerchantPage(): Promise<JSX.Element> {
  const user = await requireSurface("merchant", "/merchant");
  const t = await getTranslations("Surfaces");
  return (
    <SurfaceShell
      title={t("merchantTitle")}
      lead={t("merchantLead")}
      who={user.email ?? user.phone ?? user.id}
    />
  );
}
