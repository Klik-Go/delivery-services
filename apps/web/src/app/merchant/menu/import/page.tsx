import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { MenuImport } from "@/components/merchant/menu-import";
import { SurfaceShell } from "@/components/surface-shell";
import { requireSurface } from "@/server/auth/guards";
import { currentStoreId } from "@/server/merchant/current-store";

/** AI menu import: photo → drafts → merchant review → saved (never without review). */
export default async function MenuImportPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const user = await requireSurface("merchant", "/merchant/menu/import");
  const [t, tMenu] = await Promise.all([getTranslations("MenuImport"), getTranslations("Menu")]);
  const storeId = currentStoreId(user, (await searchParams).store);
  return (
    <SurfaceShell title={t("title")} lead={t("lead")} who={user.email ?? user.id}>
      <Link
        href={`/merchant/menu${storeId ? `?store=${storeId}` : ""}`}
        className="text-brand-800 self-start font-semibold underline"
      >
        ← {tMenu("title")}
      </Link>
      {storeId ? <MenuImport merchantId={storeId} /> : <FormError message={t("failed")} />}
    </SurfaceShell>
  );
}
