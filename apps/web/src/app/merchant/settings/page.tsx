import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { StoreSettingsForm } from "@/components/merchant/store-settings-form";
import { SurfaceShell } from "@/components/surface-shell";
import { requireSurface } from "@/server/auth/guards";
import { getContainer } from "@/server/container";
import { currentStoreId } from "@/server/merchant/current-store";

export const dynamic = "force-dynamic";

/** Store settings (owners edit; staff see them read-only). */
export default async function StoreSettingsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const user = await requireSurface("merchant", "/merchant/settings");
  const [t, tMerchant] = await Promise.all([
    getTranslations("StoreSettings"),
    getTranslations("Merchant"),
  ]);
  const storeId = currentStoreId(user, (await searchParams).store);
  const container = getContainer();
  const settings = storeId ? await container.storeSettings.settings(user, storeId) : null;
  const who = user.email ?? user.id;
  return (
    <SurfaceShell
      title={t("title")}
      eyebrow={settings?.ok ? settings.value.name : undefined}
      lead={tMerchant("settingsLead")}
      who={who}
    >
      <Link
        href={`/merchant${storeId ? `?store=${storeId}` : ""}`}
        className="text-brand-800 self-start font-semibold underline"
      >
        ← {tMerchant("back")}
      </Link>
      {settings?.ok ? (
        <StoreSettingsForm
          initial={settings.value}
          canEdit={container.authz.can(user, {
            type: "merchant.settings",
            merchantId: settings.value.merchantId,
          })}
        />
      ) : (
        <FormError message={settings ? settings.error.message : tMerchant("failed")} />
      )}
    </SurfaceShell>
  );
}
