import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import type { JSX } from "react";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { getSessionUser } from "@/server/auth/session";

/** Invited staff choose a password (reached through the invite link). */
export default async function SetPasswordPage(): Promise<JSX.Element> {
  if (!(await getSessionUser())) redirect("/auth/staff?error=link");
  const t = await getTranslations("Auth");
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-ink text-2xl font-bold">{t("setPasswordTitle")}</h1>
        <p className="text-ink-muted">{t("setPasswordLead")}</p>
      </header>
      <SetPasswordForm />
    </>
  );
}
