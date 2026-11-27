"use client";

import { Button } from "@klikgo/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { TextField } from "@/components/auth/text-field";
import { postJson } from "@/lib/post-json";

/** The invite code form; on success, on to where the customer was going. */
export function JoinForm({
  initialCode,
  next,
}: {
  readonly initialCode: string;
  readonly next: string;
}): JSX.Element {
  const t = useTranslations("Pilot.join");
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await postJson("/api/invites/redeem", { code }, t("failed"));
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDone(true);
    window.location.assign(next);
  };

  if (done)
    return (
      <p role="status" className="text-ink font-semibold">
        {t("done")}
      </p>
    );
  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <TextField
          label={t("label")}
          name="code"
          value={code}
          autoCapitalize="characters"
          autoComplete="one-time-code"
          onChange={(event) => setCode(event.target.value.toUpperCase())}
        />
        {error ? <FormError message={error} /> : null}
        <Button type="submit" disabled={busy || code.trim().length < 4}>
          {t("submit")}
        </Button>
      </form>
      <p className="text-ink-muted text-sm">
        {t("noCode")}{" "}
        <Link
          href="/address"
          className="text-ink decoration-action font-semibold underline underline-offset-2"
        >
          {t("waitlist")}
        </Link>
      </p>
    </div>
  );
}
