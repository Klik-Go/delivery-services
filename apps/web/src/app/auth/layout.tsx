import { BrandLogo } from "@klikgo/ui";
import Link from "next/link";
import type { JSX, ReactNode } from "react";

/** Centered card for every sign-in screen (mobile-first, 360 px). */
export default function AuthLayout({ children }: { readonly children: ReactNode }): JSX.Element {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-8">
      <Link href="/" className="flex items-center gap-3 self-start">
        <BrandLogo size={44} decorative />
        <span className="font-display text-brand-800 text-3xl tracking-wide">Klik Go</span>
      </Link>
      <section className="bg-surface rounded-card flex flex-col gap-5 border border-black/5 p-5 shadow-sm">
        {children}
      </section>
    </main>
  );
}
