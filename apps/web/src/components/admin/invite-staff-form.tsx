"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { INVITABLE_ROLES, InviteStaffSchema, type InviteStaff } from "@klikgo/types";
import { Button } from "@klikgo/ui";
import { useTranslations } from "next-intl";
import { useState, type JSX } from "react";
import { useForm, useWatch } from "react-hook-form";
import { FormError } from "@/components/auth/form-error";
import { TextField } from "@/components/auth/text-field";
import { postJson } from "@/lib/post-json";

/** A selectable store or zone. */
export interface Option {
  readonly id: string;
  readonly name: string;
}

/** Admin form: invite merchant, coordinator or admin staff; shows the one-time link to share. */
export function InviteStaffForm({
  merchants,
  zones,
}: {
  readonly merchants: readonly Option[];
  readonly zones: readonly Option[];
}): JSX.Element {
  const t = useTranslations("Admin");
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const form = useForm<InviteStaff>({
    resolver: standardSchemaResolver(InviteStaffSchema),
    defaultValues: { email: "", role: "merchant_owner", merchantId: null, zoneId: null },
  });
  const role = useWatch({ control: form.control, name: "role" });
  const needsMerchant = role === "merchant_owner" || role === "merchant_staff";

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    setLink(null);
    const payload = {
      ...values,
      merchantId: needsMerchant ? values.merchantId || null : null,
      zoneId: role === "coordinator" ? values.zoneId || null : null,
    };
    const result = await postJson<{ inviteUrl: string }>("/api/admin/invites", payload, "");
    if (result.ok) setLink(result.data.inviteUrl);
    else setError(result.message);
  });

  const selectClass = "border-ink-muted/40 text-ink min-h-tap rounded-xl border-2 bg-white px-3";
  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
      <TextField
        label={t("email")}
        type="email"
        error={form.formState.errors.email?.message}
        {...form.register("email")}
      />
      <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
        {t("role")}
        <select className={selectClass} {...form.register("role")}>
          {INVITABLE_ROLES.map((value) => (
            <option key={value} value={value}>
              {t(`roles.${value}`)}
            </option>
          ))}
        </select>
      </label>
      {needsMerchant ? (
        <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
          {t("merchant")}
          <select className={selectClass} {...form.register("merchantId")}>
            <option value="">{t("choose")}</option>
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {role === "coordinator" ? (
        <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
          {t("zone")}
          <select className={selectClass} {...form.register("zoneId")}>
            <option value="">{t("choose")}</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <FormError message={error} />
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? t("inviting") : t("invite")}
      </Button>
      {link ? (
        <div
          role="status"
          className="bg-accent-100 text-ink flex flex-col gap-2 rounded-xl p-3 text-sm"
        >
          <p>{t("created")}</p>
          <code className="break-all">{link}</code>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}
          >
            {copied ? t("copied") : t("copy")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
