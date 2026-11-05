import { Camera } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { MenuManager } from "@/components/merchant/menu-manager";
import { SurfaceShell } from "@/components/surface-shell";
import { requireSurface } from "@/server/auth/guards";
import { currentStoreId } from "@/server/merchant/current-store";

/** The menu manager (docs/BUSINESS.md §9.2.2). */
export default async function MenuPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const user = await requireSurface("merchant", "/merchant/menu");
  const [t, tMerchant] = await Promise.all([getTranslations("Menu"), getTranslations("Merchant")]);
  const storeId = currentStoreId(user, (await searchParams).store);
  return (
    <SurfaceShell title={t("title")} lead={tMerchant("menuLead")} who={user.email ?? user.id}>
      <div className="flex flex-wrap gap-4">
        <Link
          href={`/merchant${storeId ? `?store=${storeId}` : ""}`}
          className="text-brand-800 font-semibold underline"
        >
          ← {tMerchant("back")}
        </Link>
        {storeId ? (
          <Link
            href={`/merchant/menu/import?store=${storeId}`}
            className="text-brand-800 inline-flex items-center gap-1 font-semibold underline"
          >
            <Camera aria-hidden className="size-4" />
            {t("importLink")}
          </Link>
        ) : null}
      </div>
      {storeId ? <MenuManager merchantId={storeId} /> : <FormError message={tMerchant("failed")} />}
    </SurfaceShell>
  );
}
