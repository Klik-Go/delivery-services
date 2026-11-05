"use client";

import { Button } from "@klikgo/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type JSX } from "react";
import { postJson } from "@/lib/post-json";
import { FormError } from "./form-error";
import { OtpCodeInput } from "./otp-code-input";

interface Enrollment {
  factorId: string;
  qrCode: string;
  secret: string;
}

function useVerify(next: string | null): {
  code: string;
  setCode: (code: string) => void;
  error: string | null;
  busy: boolean;
  submit: (factorId: string | null) => Promise<void>;
} {
  const t = useTranslations("Auth");
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(factorId: string | null): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await postJson<{ next: string }>(
      "/api/auth/mfa/verify",
      { factorId, code },
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
  return { code, setCode, error, busy, submit };
}

/** First-time authenticator setup: QR code + manual key, then confirm with a code. */
export function MfaEnroll({ next }: { readonly next: string | null }): JSX.Element {
  const t = useTranslations("Auth");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const verify = useVerify(next);

  async function start(): Promise<void> {
    setStartError(null);
    const result = await postJson<Enrollment>("/api/auth/mfa/enroll", {}, t("genericError"));
    if (result.ok) setEnrollment(result.data);
    else setStartError(result.message);
  }

  if (!enrollment) {
    return (
      <div className="flex flex-col gap-4">
        <FormError message={startError} />
        <Button type="button" onClick={() => void start()}>
          {t("startEnroll")}
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void verify.submit(enrollment.factorId);
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-ink text-sm">{t("scanQr")}</p>
      {/* Supabase returns the QR code as an SVG data URI (allowed by the CSP img-src data:). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={enrollment.qrCode}
        alt={t("qrAlt")}
        width={192}
        height={192}
        className="mx-auto rounded-xl bg-white p-2"
      />
      <div className="bg-surface-muted rounded-xl p-3">
        <p className="text-ink-muted text-xs font-semibold uppercase">{t("setupKey")}</p>
        <code data-testid="totp-secret" className="text-ink font-mono text-sm break-all">
          {enrollment.secret}
        </code>
      </div>
      <p className="text-ink text-sm">{t("enterAppCode")}</p>
      <OtpCodeInput
        value={verify.code}
        onChange={verify.setCode}
        disabled={verify.busy}
        invalid={Boolean(verify.error)}
      />
      <FormError message={verify.error} />
      <Button type="submit" disabled={verify.busy || verify.code.length !== 6}>
        {verify.busy ? t("verifying") : t("verify")}
      </Button>
    </form>
  );
}

/** Returning staff: enter the current authenticator code. */
export function MfaVerifyForm({ next }: { readonly next: string | null }): JSX.Element {
  const t = useTranslations("Auth");
  const verify = useVerify(next);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void verify.submit(null);
      }}
      className="flex flex-col gap-4"
    >
      <OtpCodeInput
        value={verify.code}
        onChange={verify.setCode}
        disabled={verify.busy}
        invalid={Boolean(verify.error)}
      />
      <FormError message={verify.error} />
      <Button type="submit" disabled={verify.busy || verify.code.length !== 6}>
        {verify.busy ? t("verifying") : t("verify")}
      </Button>
    </form>
  );
}
