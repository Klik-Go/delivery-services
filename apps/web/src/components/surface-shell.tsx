import { BrandLogo } from "@klikgo/ui";
import { getTranslations } from "next-intl/server";
import type { JSX, ReactNode } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";

/** Header + content frame shared by the merchant, rider and admin surfaces. */
export async function SurfaceShell({
  title,
  lead,
  who,
  children,
}: {
  readonly title: string;
  readonly lead: string;
  readonly who: string;
  readonly children?: ReactNode;
}): Promise<JSX.Element> {
  const t = await getTranslations("Home");
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-screen-md flex-col gap-6 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BrandLogo size={40} decorative />
          <span className="font-display text-brand-800 text-2xl tracking-wide">Klik Go</span>
        </div>
        <SignOutButton label={t("signOut")} />
      </header>
      <main className="flex flex-col gap-4">
        <h1 className="text-ink text-3xl font-bold">{title}</h1>
        <p className="text-ink-muted">{lead}</p>
        <p className="text-ink-muted text-sm">{t("signedInAs", { who })}</p>
        {children}
      </main>
    </div>
  );
}
