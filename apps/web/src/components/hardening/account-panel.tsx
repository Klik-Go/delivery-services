"use client";

import { DELETE_CONFIRMATION } from "@klikgo/types";
import { Button } from "@klikgo/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { postJson } from "@/lib/post-json";

/** The person's data rights: download everything, or delete the account (typed confirmation). */
export function AccountPanel(): JSX.Element {
  const t = useTranslations("Hardening.account");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  const remove = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await postJson("/api/me/delete", { confirm }, t("failed"));
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDeleted(true);
  };

  if (deleted) {
    return (
      <p role="status" className="text-ink bg-surface-muted rounded-lg p-4 font-semibold">
        {t("deleted")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2" aria-labelledby="your-data">
        <h2 id="your-data" className="text-ink text-lg font-bold">
          {t("dataTitle")}
        </h2>
        <p className="text-ink">{t("dataLead")}</p>
        <a
          href="/api/me/export"
          download
          className="bg-brand-800 min-h-tap inline-flex items-center justify-center self-start rounded-lg px-4 font-semibold text-white"
        >
          {t("download")}
        </a>
      </section>
      <section className="flex flex-col gap-2" aria-labelledby="delete-account">
        <h2 id="delete-account" className="text-ink text-lg font-bold">
          {t("deleteTitle")}
        </h2>
        <p className="text-ink">{t("deleteLead")}</p>
        <form onSubmit={(e) => void remove(e)} className="flex flex-col gap-2">
          <label className="text-ink flex flex-col gap-1 font-semibold">
            {t("confirmLabel")}
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              className="border-ink-muted min-h-tap rounded-lg border px-3"
              placeholder={DELETE_CONFIRMATION}
            />
          </label>
          {error ? <FormError message={error} /> : null}
          <Button
            type="submit"
            className="bg-danger-900 hover:bg-danger-900 text-white"
            disabled={busy || confirm.length === 0}
          >
            {busy ? t("deleting") : t("delete")}
          </Button>
        </form>
      </section>
      <p className="text-ink-muted text-sm">
        {t.rich("documents", {
          privacy: (chunks) => (
            <Link href="/legal/privacy" className="text-action">
              {chunks}
            </Link>
          ),
          terms: (chunks) => (
            <Link href="/legal/terms" className="text-action">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </div>
  );
}
