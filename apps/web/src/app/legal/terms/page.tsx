import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { LegalDocument } from "@/components/hardening/legal-document";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Hardening.legal.terms"))("title") };
}

/** The terms of service, public. */
export default function TermsPage(): Promise<JSX.Element> {
  return LegalDocument({ document: "terms" });
}
