import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";

/** Links to the privacy notice and terms (and the account page when signed in). */
export async function LegalFooter({ signedIn = false }: { readonly signedIn?: boolean }): Promise<JSX.Element> {
  const t = await getTranslations("Hardening");
  const link = "text-ink-muted min-h-tap inline-flex items-center text-sm underline";
  return (
    <footer className="mt-auto flex flex-wrap gap-x-4 pt-4">
      {signedIn ? (
        <Link href="/account" className={link}>
          {t("account.title")}
        </Link>
      ) : null}
      <Link href="/legal/privacy" className={link}>
        {t("legal.privacyLink")}
      </Link>
      <Link href="/legal/terms" className={link}>
        {t("legal.termsLink")}
      </Link>
    </footer>
  );
}
