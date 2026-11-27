import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { PayoutsPanel } from "@/components/finance/payouts-panel";
import { SurfaceShell } from "@/components/surface-shell";
import { requireSurface } from "@/server/auth/guards";
import { getContainer } from "@/server/container";
import { currentStoreId } from "@/server/merchant/current-store";

export const dynamic = "force-dynamic";

/** The store's payouts: where it is paid and weekly statements (owners only). */
export default async function MerchantPayoutsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const user = await requireSurface("merchant", "/merchant/payouts");
  const [t, tMerchant] = await Promise.all([
    getTranslations("Finance"),
    getTranslations("Merchant"),
  ]);
  const storeId = currentStoreId(user, (await searchParams).store);
  const owner =
    storeId !== null &&
    getContainer().authz.can(user, { type: "merchant.settings", merchantId: storeId });
  return (
    <SurfaceShell
      title={t("statements.pageTitle")}
      lead={t("statements.pageLead")}
      who={user.email ?? user.id}
    >
      <Link
        href={`/merchant${storeId ? `?store=${storeId}` : ""}`}
        className="text-action self-start font-semibold underline"
      >
        ← {tMerchant("back")}
      </Link>
      {owner && storeId ? (
        <PayoutsPanel base={`/api/merchant/${storeId}/payouts`} kind="merchant" />
      ) : (
        <FormError message={t("statements.ownerOnly")} />
      )}
    </SurfaceShell>
  );
}
