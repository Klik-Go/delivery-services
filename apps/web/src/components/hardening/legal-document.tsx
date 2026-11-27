import { LEGAL_VERSIONS, type LegalDocument as Doc } from "@klikgo/types";
import { BrandLogo, Sheet, SheetSection, StatusMark } from "@klikgo/ui";
import { FileWarning } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";

interface Section {
  readonly heading: string;
  readonly body: string;
}

/** A legal page (privacy notice or terms): the template text, its version and the review banner. */
export async function LegalDocument({
  document,
}: {
  readonly document: Doc;
}): Promise<JSX.Element> {
  const t = await getTranslations("Hardening.legal");
  const sections = t.raw(`${document}.sections`) as Section[];
  return (
    <main className="bg-canvas text-ink mx-auto flex min-h-dvh w-full max-w-screen-md flex-col gap-4 px-4 py-6">
      <Link href="/" className="text-action min-h-tap inline-flex items-center gap-2 font-semibold">
        <BrandLogo size={28} decorative />
        {t("back")}
      </Link>
      <Sheet>
        <SheetSection first className="flex flex-col gap-2">
          <h1 className="text-document text-ink">{t(`${document}.title`)}</h1>
          <p className="text-record text-ink-muted">
            {t("updated", { date: LEGAL_VERSIONS[document] })}
          </p>
          <p role="note">
            <StatusMark tone="awaiting" icon={<FileWarning aria-hidden />} label={t("draft")} />
          </p>
        </SheetSection>
        <SheetSection className="flex flex-col gap-4">
          <p className="text-body text-ink">{t(`${document}.intro`)}</p>
          {sections.map((section) => (
            <section key={section.heading} className="flex flex-col gap-1">
              <h2 className="text-title text-ink">{section.heading}</h2>
              <p className="text-body text-ink">{section.body}</p>
            </section>
          ))}
        </SheetSection>
      </Sheet>
    </main>
  );
}
