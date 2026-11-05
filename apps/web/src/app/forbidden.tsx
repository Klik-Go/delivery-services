import { Button } from "@klikgo/ui";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { JSX } from "react";

/** 403 page rendered by forbidden() when the signed-in role may not open a surface. */
export default async function Forbidden(): Promise<JSX.Element> {
  const t = await getTranslations("Surfaces");
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4">
      <h1 className="text-ink text-2xl font-bold">{t("forbiddenTitle")}</h1>
      <p className="text-ink-muted">{t("forbiddenLead")}</p>
      <Button asChild>
        <Link href="/">{t("goHome")}</Link>
      </Button>
    </main>
  );
}
