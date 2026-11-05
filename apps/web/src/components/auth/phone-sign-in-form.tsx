"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { OtpRequestSchema, type OtpRequest } from "@klikgo/types";
import { Button } from "@klikgo/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type JSX } from "react";
import { useForm } from "react-hook-form";
import { postJson } from "@/lib/post-json";
import { FormError } from "./form-error";
import { TextField } from "./text-field";

/** Step 1 of phone sign-in: ask Klik Go to text a code. */
export function PhoneSignInForm({ next }: { readonly next: string | null }): JSX.Element {
  const t = useTranslations("Auth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<OtpRequest>({
    resolver: standardSchemaResolver(OtpRequestSchema),
    defaultValues: { phone: "" },
  });

  const onSubmit = form.handleSubmit(async ({ phone }) => {
    setError(null);
    const result = await postJson<{ phone: string }>("/api/auth/otp", { phone }, t("genericError"));
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const query = new URLSearchParams({ phone: result.data.phone });
    if (next) query.set("next", next);
    router.push(`/auth/verify?${query.toString()}`);
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
      <TextField
        label={t("mobileNumber")}
        type="tel"
        autoComplete="tel-national"
        inputMode="tel"
        placeholder={t("mobilePlaceholder")}
        error={form.formState.errors.phone?.message}
        {...form.register("phone")}
      />
      <FormError message={error} />
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? t("sending") : t("sendCode")}
      </Button>
    </form>
  );
}
