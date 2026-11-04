import { THEME_COLOR } from "@klikgo/config/tokens";
import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import type { JSX, ReactNode } from "react";
import "./globals.css";

/** Localised title and description. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Metadata");
  return {
    title: { default: t("title"), template: "%s · Klik Go" },
    description: t("description"),
    applicationName: "Klik Go",
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: THEME_COLOR,
};

/** Root layout shared by every surface (customer, merchant, rider, admin). */
export default async function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}): Promise<JSX.Element> {
  // Render per request: the CSP nonce changes on every response, so pages cannot be prerendered.
  await connection();
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className="min-h-dvh">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
