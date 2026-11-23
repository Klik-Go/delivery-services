"use client";

import { LEGAL_VERSIONS } from "@klikgo/types";
import { Button } from "@klikgo/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type JSX, type ReactNode } from "react";
import { FormError } from "@/components/auth/form-error";
import { postJson } from "@/lib/post-json";

/** Agreeing to the current terms and privacy notice; then on to where the person was going. */
export function ConsentForm({ next }: { readonly next: string }): JSX.Element {
  const t = useTranslations("Hardening.consent");
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!terms || !privacy) {
      setError(t("required"));
      return;
    }
    setBusy(true);
    setError(null);
    const saved = await postJson("/api/me/consents", LEGAL_VERSIONS, t("failed"));
    if (!saved.ok) {
      setBusy(false);
      setError(saved.message);
      return;
    }
    window.location.assign(next);
  };

  const link =
    (href: string) =>
    (chunks: ReactNode): JSX.Element => (
      <Link href={href} target="_blank" className="text-brand-800 font-semibold underline">
        {chunks}
      </Link>
    );

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
      <label className="text-ink flex min-h-tap items-start gap-3">
        <input
          type="checkbox"
          checked={terms}
          onChange={(e) => setTerms(e.target.checked)}
          className="mt-1 size-5"
          name="terms"
        />
        <span>{t.rich("terms", { link: link("/legal/terms") })}</span>
      </label>
      <label className="text-ink flex min-h-tap items-start gap-3">
        <input
          type="checkbox"
          checked={privacy}
          onChange={(e) => setPrivacy(e.target.checked)}
          className="mt-1 size-5"
          name="privacy"
        />
        <span>{t.rich("privacy", { link: link("/legal/privacy") })}</span>
      </label>
      {error ? <FormError message={error} /> : null}
      <Button type="submit" disabled={busy}>
        {t("submit")}
      </Button>
    </form>
  );
}
