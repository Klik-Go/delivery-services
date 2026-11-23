import { safeNext } from "@klikgo/core";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { JoinForm } from "@/components/pilot/join-form";
import { getSessionUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Pilot.join"))("title") };
}

/** Invite code entry for the invite-only pilot (flyers link here with ?code=). */
export default async function JoinPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const code =
    typeof params.code === "string" ? params.code.replace(/[^A-Za-z0-9]/g, "").slice(0, 20) : "";
  const next = safeNext(typeof params.next === "string" ? params.next : "/");
  const user = await getSessionUser();
  if (!user) {
    const back = `/join?${new URLSearchParams({ ...(code ? { code } : {}), next }).toString()}`;
    redirect(`/auth/sign-in?next=${encodeURIComponent(back)}`);
  }
  const t = await getTranslations("Pilot.join");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col gap-4 px-4 py-6">
      <h1 className="font-display text-ink text-3xl">{t("title")}</h1>
      <p className="text-ink">{t("lead")}</p>
      <JoinForm initialCode={code} next={next} />
    </main>
  );
}
