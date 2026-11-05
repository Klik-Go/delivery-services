"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { PasswordSignInSchema, type PasswordSignIn } from "@klikgo/types";
import { Button } from "@klikgo/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type JSX } from "react";
import { useForm } from "react-hook-form";
import { postJson } from "@/lib/post-json";
import { FormError } from "./form-error";
import { TextField } from "./text-field";

/** Staff first factor (email + password); always continues to the authenticator step. */
export function StaffSignInForm({ next }: { readonly next: string | null }): JSX.Element {
  const t = useTranslations("Auth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<PasswordSignIn>({
    resolver: standardSchemaResolver(PasswordSignInSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const result = await postJson<{ next: string }>(
      "/api/auth/password",
      values,
      t("genericError"),
    );
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.push(next ? `${result.data.next}?next=${encodeURIComponent(next)}` : result.data.next);
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
      <TextField
        label={t("email")}
        type="email"
        autoComplete="username"
        error={form.formState.errors.email?.message}
        {...form.register("email")}
      />
      <TextField
        label={t("password")}
        type="password"
        autoComplete="current-password"
        error={form.formState.errors.password?.message}
        {...form.register("password")}
      />
      <FormError message={error} />
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {t("signIn")}
      </Button>
    </form>
  );
}
