"use client";

import { Button } from "@klikgo/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, type JSX } from "react";
import { currentPath, reportClientError } from "@/lib/telemetry";

/** A page crashed: tell the error tracker (through the BFF, scrubbed) and offer a way out. */
export default function PageError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}): JSX.Element {
  const t = useTranslations("Hardening.errors");
  useEffect(() => {
    reportClientError({
      kind: "boundary",
      message: error.message || error.name,
      ...(error.stack ? { stack: error.stack } : {}),
      ...(error.digest ? { digest: error.digest } : {}),
      path: currentPath(),
    });
  }, [error]);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col justify-center gap-4 px-4 py-6">
      <h1 className="font-display text-ink text-3xl">{t("title")}</h1>
      <p className="text-ink">{t("lead")}</p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={reset}>{t("retry")}</Button>
        <Link
          href="/"
          className="text-brand-800 min-h-tap inline-flex items-center font-semibold underline"
        >
          {t("home")}
        </Link>
      </div>
    </main>
  );
}
