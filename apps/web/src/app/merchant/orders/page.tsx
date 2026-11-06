import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { OrderBoard } from "@/components/merchant/order-board";
import { requireSurface } from "@/server/auth/guards";
import { getContainer } from "@/server/container";
import { currentStoreId } from "@/server/merchant/current-store";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Merchant.orders"))("title") };
}

/** The store's live order board: accept with a prep time, reject, mark ready. */
export default async function MerchantOrdersPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const user = await requireSurface("merchant", "/merchant/orders");
  const t = await getTranslations("Merchant.orders");
  const storeId = currentStoreId(user, (await searchParams).store);
  const settings = storeId ? await getContainer().storeSettings.settings(user, storeId) : null;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-screen-xl flex-col gap-4 px-4 py-4">
      <Link
        href={storeId ? `/merchant?store=${storeId}` : "/merchant"}
        className="text-brand-800 min-h-tap inline-flex items-center gap-1 self-start font-semibold"
      >
        <ChevronLeft aria-hidden className="size-5" />
        {t("back")}
      </Link>
      {settings?.ok ? (
        <OrderBoard merchantId={settings.value.merchantId} storeName={settings.value.name} />
      ) : (
        <FormError message={settings ? settings.error.message : t("noStore")} />
      )}
    </main>
  );
}
