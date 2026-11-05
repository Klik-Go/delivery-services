import { ChevronRight, Camera, Settings, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { OpenToggle } from "@/components/merchant/open-toggle";
import { SurfaceShell } from "@/components/surface-shell";
import { requireSurface } from "@/server/auth/guards";
import { getContainer } from "@/server/container";
import { currentStoreId } from "@/server/merchant/current-store";

export const dynamic = "force-dynamic";

/** Merchant dashboard: open/closed, and the way into menu, settings and AI import. */
export default async function MerchantPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const user = await requireSurface("merchant", "/merchant");
  const t = await getTranslations("Merchant");
  const storeId = currentStoreId(user, (await searchParams).store);
  const settings = storeId ? await getContainer().storeSettings.settings(user, storeId) : null;
  const who = user.email ?? user.phone ?? user.id;
  if (!settings?.ok) {
    return (
      <SurfaceShell title={t("eyebrow")} lead={t("lead")} who={who}>
        <FormError message={settings ? settings.error.message : t("failed")} />
      </SurfaceShell>
    );
  }
  const store = settings.value;
  const query = `?store=${store.merchantId}`;
  const links = [
    {
      href: `/merchant/menu${query}`,
      title: t("menu"),
      lead: t("menuLead"),
      Icon: UtensilsCrossed,
    },
    {
      href: `/merchant/menu/import${query}`,
      title: t("import"),
      lead: t("importLead"),
      Icon: Camera,
    },
    {
      href: `/merchant/settings${query}`,
      title: t("settings"),
      lead: t("settingsLead"),
      Icon: Settings,
    },
  ];
  return (
    <SurfaceShell title={store.name} eyebrow={t("eyebrow")} lead={t("lead")} who={who}>
      <OpenToggle
        merchantId={store.merchantId}
        initiallyOpen={store.isOpen}
        approved={store.status === "active"}
      />
      <nav aria-label={t("eyebrow")}>
        <ul className="flex flex-col gap-3">
          {links.map(({ href, title, lead, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="rounded-card hover:bg-brand-50 border-brand-100 flex items-center gap-3 border-2 p-4"
              >
                <Icon aria-hidden className="text-brand-800 size-6 shrink-0" />
                <span className="flex flex-1 flex-col">
                  <span className="text-ink font-bold">{title}</span>
                  <span className="text-ink-muted text-sm">{lead}</span>
                </span>
                <ChevronRight aria-hidden className="text-ink-muted size-5" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <a className="text-brand-800 self-start font-semibold underline" href={`/s/${store.slug}`}>
        {t("storePage")}
      </a>
    </SurfaceShell>
  );
}
