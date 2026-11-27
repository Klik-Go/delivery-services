import { BrandLogo, Masthead, Sheet, SheetSection, SkipLink } from "@klikgo/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { JSX, ReactNode } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { RiderBottomNav } from "@/components/rider/rider-bottom-nav";

/**
 * Compact portal chrome for rider and merchant phone surfaces.
 * Identity lives in Settings — not in the masthead. Page title lives only in `#main`
 * so cucumber/e2e locators for "Merchant dashboard" stay unique.
 */
export async function SurfaceShell({
  title,
  eyebrow,
  lead,
  who: _who,
  children,
  riderNav = false,
}: {
  readonly title: string;
  /** Small label above the title, e.g. "Merchant dashboard" over the store name. */
  readonly eyebrow?: string | undefined;
  readonly lead: string;
  readonly who: string;
  readonly children?: ReactNode;
  /** Rider PWA: Home + Earnings bottom tabs (44px targets). */
  readonly riderNav?: boolean | undefined;
}): Promise<JSX.Element> {
  const t = await getTranslations("Home");
  const tRider = riderNav ? await getTranslations("Rider.tabs") : null;
  return (
    <div className="bg-canvas text-ink min-h-dvh">
      <SkipLink label={tRider ? tRider("skip") : "Skip to content"} />
      <Masthead
        density="compact"
        brand={
          <Link href="/" className="flex items-center gap-2">
            <BrandLogo size={36} decorative />
            <span className="font-display text-accent text-2xl tracking-wide">Klik Go</span>
          </Link>
        }
        actions={
          <SignOutButton
            label={t("signOut")}
            variant="ghost"
            className="text-masthead-ink hover:text-masthead-ink hover:bg-white/10"
          />
        }
      />
      <main
        id="main"
        className={
          riderNav
            ? "mx-auto flex w-full max-w-screen-md flex-col gap-4 px-4 py-5 pb-[calc(4.5rem+env(safe-area-inset-bottom))]"
            : "mx-auto flex w-full max-w-screen-md flex-col gap-4 px-4 py-5"
        }
      >
        <Sheet>
          <SheetSection first className="flex flex-col gap-2">
            {eyebrow ? <p className="text-label text-action uppercase">{eyebrow}</p> : null}
            <h1 className="text-document text-ink">{title}</h1>
            <p className="text-body text-ink-muted">{lead}</p>
          </SheetSection>
        </Sheet>
        {children}
      </main>
      {riderNav ? <RiderBottomNav /> : null}
    </div>
  );
}
