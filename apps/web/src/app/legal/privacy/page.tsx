import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { LegalDocument } from "@/components/hardening/legal-document";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Hardening.legal.privacy"))("title") };
}

/** The privacy notice (RA 10173), public. */
export default function PrivacyPage(): Promise<JSX.Element> {
  return LegalDocument({ document: "privacy" });
}
