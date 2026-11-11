import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { RiderApp } from "@/components/rider/rider-app";
import { SurfaceShell } from "@/components/surface-shell";
import { requireSurface } from "@/server/auth/guards";

/** The rider app: online switch, offers, the job in hand and earnings (Phase 7). */
export default async function RiderPage(): Promise<JSX.Element> {
  const user = await requireSurface("rider", "/rider");
  const t = await getTranslations("Surfaces");
  return (
    <SurfaceShell title={t("riderTitle")} lead={t("riderLead")} who={user.phone ?? user.id}>
      <RiderApp />
    </SurfaceShell>
  );
}
