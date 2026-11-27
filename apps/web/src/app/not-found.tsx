import { Button, EmptyState } from "@klikgo/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";

/** Global 404 — sheet empty state, not a blank browser page. */
export default async function NotFound(): Promise<JSX.Element> {
  const t = await getTranslations("Surfaces");
  return (
    <main className="bg-canvas mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col justify-center px-4 py-10">
      <EmptyState
        title={t("notFoundTitle")}
        description={t("notFoundLead")}
        action={
          <Button asChild>
            <Link href="/">{t("goHome")}</Link>
          </Button>
        }
      />
    </main>
  );
}
