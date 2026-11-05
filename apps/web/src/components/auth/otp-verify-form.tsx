"use client";

import { Button } from "@klikgo/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, type JSX } from "react";
import { postJson } from "@/lib/post-json";
import { FormError } from "./form-error";
import { OtpCodeInput } from "./otp-code-input";

const RESEND_AFTER_SECONDS = 60;

/** Step 2 of phone sign-in: enter the texted code (with a resend timer). */
export function OtpVerifyForm({
  phone,
  next,
}: {
  readonly phone: string;
  readonly next: string | null;
}): JSX.Element {
  const t = useTranslations("Auth");
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(() => Date.now() + RESEND_AFTER_SECONDS * 1000);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));

  async function verify(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await postJson<{ next: string }>(
      "/api/auth/otp/verify",
      { phone, code },
      t("genericError"),
    );
    if (result.ok) {
      router.replace(next ?? result.data.next);
      router.refresh();
      return;
    }
    setBusy(false);
    setError(result.message);
  }

  async function resend(): Promise<void> {
    setError(null);
    const result = await postJson("/api/auth/otp", { phone }, t("genericError"));
    if (result.ok) {
      setNotice(t("codeSent"));
      setResendAt(Date.now() + RESEND_AFTER_SECONDS * 1000);
    } else {
      setError(result.message);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void verify();
      }}
      className="flex flex-col gap-4"
    >
      <OtpCodeInput value={code} onChange={setCode} disabled={busy} invalid={Boolean(error)} />
      <FormError message={error} />
      {notice ? (
        <p role="status" className="text-ink-muted text-sm">
          {notice}
        </p>
      ) : null}
      <Button type="submit" disabled={busy || code.length !== 6}>
        {busy ? t("verifying") : t("verify")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={secondsLeft > 0}
        onClick={() => void resend()}
      >
        {secondsLeft > 0 ? t("resendIn", { seconds: secondsLeft }) : t("resend")}
      </Button>
    </form>
  );
}
