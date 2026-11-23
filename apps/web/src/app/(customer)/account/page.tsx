import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { AccountPanel } from "@/components/hardening/account-panel";
import { getSessionUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Hardening.account"))("title") };
}

/** The signed-in person's account: download their data or delete the account (RA 10173). */
export default async function AccountPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect("/auth/sign-in?next=/account");
  const t = await getTranslations("Hardening.account");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col gap-4 px-4 py-4">
      <h1 className="text-ink text-2xl font-bold">{t("title")}</h1>
      <AccountPanel />
    </main>
  );
}
