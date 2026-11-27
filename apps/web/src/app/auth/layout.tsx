import { BrandLogo, Sheet, SheetSection, SkipLink } from "@klikgo/ui";
import Link from "next/link";
import type { JSX, ReactNode } from "react";
import { LegalFooter } from "@/components/hardening/legal-footer";

/** Centered sheet for every sign-in screen (mobile-first portal). */
export default function AuthLayout({ children }: { readonly children: ReactNode }): JSX.Element {
  return (
    <div className="bg-canvas min-h-dvh">
      <SkipLink label="Skip to content" />
      <main
        id="main"
        className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-8"
      >
        <Link href="/" className="flex items-center gap-3 self-start">
          <BrandLogo size={44} decorative />
          <span className="font-display text-action text-3xl tracking-wide">Klik Go</span>
        </Link>
        <Sheet>
          <SheetSection first className="flex flex-col gap-5">
            {children}
          </SheetSection>
        </Sheet>
        <LegalFooter />
      </main>
    </div>
  );
}
