"use client";

import { Button } from "@klikgo/ui";
import { useTranslations } from "next-intl";
import { useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { requestJson } from "@/lib/post-json";

/** Opens or closes the store for orders right now (any team member). */
export function OpenToggle({
  merchantId,
  initiallyOpen,
  approved,
}: {
  readonly merchantId: string;
  readonly initiallyOpen: boolean;
  readonly approved: boolean;
}): JSX.Element {
  const t = useTranslations("Merchant");
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await requestJson<{ isOpen: boolean }>(
      "PUT",
      `/api/merchant/${merchantId}/open`,
      { isOpen: !isOpen },
      t("failed"),
    );
    setBusy(false);
    if (result.ok) setIsOpen(result.data.isOpen);
    else setError(result.message);
  }

  return (
    <section className="bg-surface-muted rounded-card flex flex-col gap-3 p-4">
      <p className="text-ink flex items-center gap-2 text-lg font-bold" aria-live="polite">
        <span
          aria-hidden
          className={`size-3 rounded-full ${isOpen ? "bg-brand-600" : "bg-ink-muted"}`}
        />
        {isOpen ? t("isOpen") : t("isClosed")}
      </p>
      {approved ? (
        <Button
          variant={isOpen ? "secondary" : "primary"}
          onClick={() => void toggle()}
          disabled={busy}
          className="self-start"
        >
          {isOpen ? t("close") : t("open")}
        </Button>
      ) : (
        <p className="text-ink-muted text-sm">{t("notApproved")}</p>
      )}
      <FormError message={error} />
    </section>
  );
}
