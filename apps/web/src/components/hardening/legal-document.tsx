import { LEGAL_VERSIONS, type LegalDocument as Doc } from "@klikgo/types";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";

interface Section {
  readonly heading: string;
  readonly body: string;
}

/** A legal page (privacy notice or terms): the template text, its version and the review banner. */
export async function LegalDocument({ document }: { readonly document: Doc }): Promise<JSX.Element> {
  const t = await getTranslations("Hardening.legal");
  const sections = t.raw(`${document}.sections`) as Section[];
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-screen-md flex-col gap-4 px-4 py-6">
      <Link href="/" className="text-brand-800 min-h-tap inline-flex items-center font-semibold underline">
        {t("back")}
      </Link>
      <h1 className="font-display text-ink text-3xl">{t(`${document}.title`)}</h1>
      <p className="text-ink-muted text-sm">{t("updated", { date: LEGAL_VERSIONS[document] })}</p>
      <p role="note" className="bg-accent-100 text-ink rounded-lg p-3 text-sm font-semibold">
        {t("draft")}
      </p>
      <p className="text-ink">{t(`${document}.intro`)}</p>
      {sections.map((section) => (
        <section key={section.heading} className="flex flex-col gap-1">
          <h2 className="text-ink text-lg font-bold">{section.heading}</h2>
          <p className="text-ink">{section.body}</p>
        </section>
      ))}
    </main>
  );
}
