"use client";

import { Button } from "@klikgo/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type JSX } from "react";
import { useForm } from "react-hook-form";
import { postJson } from "@/lib/post-json";
import { FormError } from "./form-error";
import { TextField } from "./text-field";

interface Values {
  password: string;
  confirm: string;
}

/** Invited staff choose their password (length rules are enforced by the server). */
export function SetPasswordForm(): JSX.Element {
  const t = useTranslations("Auth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ defaultValues: { password: "", confirm: "" } });

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(null);
    const result = await postJson<{ next: string }>(
      "/api/auth/set-password",
      { password },
      t("genericError"),
    );
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.push(result.data.next);
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
      <TextField
        label={t("newPassword")}
        type="password"
        autoComplete="new-password"
        minLength={12}
        error={form.formState.errors.password?.message}
        {...form.register("password", { required: true })}
      />
      <TextField
        label={t("confirmPassword")}
        type="password"
        autoComplete="new-password"
        error={form.formState.errors.confirm?.message}
        {...form.register("confirm", {
          validate: (value, values) => value === values.password || t("passwordsDiffer"),
        })}
      />
      <FormError message={error} />
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {t("savePassword")}
      </Button>
    </form>
  );
}
