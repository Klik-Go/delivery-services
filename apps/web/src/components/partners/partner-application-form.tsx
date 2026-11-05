"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import {
  MERCHANT_CATEGORIES,
  MerchantApplicationSchema,
  type MerchantApplicationInput,
} from "@klikgo/types";
import { Button } from "@klikgo/ui";
import { CheckCircle2, LocateFixed } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type JSX } from "react";
import { Controller, useForm } from "react-hook-form";
import { FormError } from "@/components/auth/form-error";
import { TextField } from "@/components/auth/text-field";
import { PinMap } from "@/components/map/pin-map";
import { postJson } from "@/lib/post-json";

/** Where the map starts: the pilot zone (docs/OPEN_QUESTIONS.md Q8). */
const PILOT_CENTRE = { lat: 14.5995, lng: 120.9842 };

/** The public "Become a partner" form with a pin on the map (docs/BUSINESS.md §5.4). */
export function PartnerApplicationForm(): JSX.Element {
  const t = useTranslations("Partners");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ inArea: boolean } | null>(null);
  const [locating, setLocating] = useState(false);
  const form = useForm<MerchantApplicationInput>({
    resolver: standardSchemaResolver(MerchantApplicationSchema),
    defaultValues: {
      businessName: "",
      ownerName: "",
      phone: "",
      email: "",
      category: "food",
      barangay: "",
      city: "",
      addressLine: "",
      location: PILOT_CENTRE,
      website: "",
    },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const result = await postJson<{ inArea: boolean }>(
      "/api/partners/applications",
      values,
      t("failed"),
    );
    if (result.ok) setDone({ inArea: result.data.inArea });
    else setError(result.message);
  });

  function locate(): void {
    if (!("geolocation" in navigator)) {
      setError(t("locationDenied"));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        form.setValue("location", {
          lat: Number(position.coords.latitude.toFixed(6)),
          lng: Number(position.coords.longitude.toFixed(6)),
        });
      },
      () => {
        setLocating(false);
        setError(t("locationDenied"));
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  if (done) {
    return (
      <section
        aria-live="polite"
        className="bg-surface-muted rounded-card flex flex-col items-start gap-3 p-6"
      >
        <CheckCircle2 aria-hidden className="text-brand-800 size-10" />
        <h2 className="text-ink text-2xl font-bold">{t("thanksTitle")}</h2>
        <p className="text-ink">{done.inArea ? t("thanksInArea") : t("thanksOutOfArea")}</p>
      </section>
    );
  }

  const selectClass = "border-ink-muted/40 text-ink min-h-tap rounded-xl border-2 bg-white px-3";
  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4" noValidate>
      <TextField
        label={t("businessName")}
        autoComplete="organization"
        error={errors.businessName?.message}
        {...form.register("businessName")}
      />
      <TextField
        label={t("ownerName")}
        autoComplete="name"
        error={errors.ownerName?.message}
        {...form.register("ownerName")}
      />
      <TextField
        label={t("phone")}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="0917 123 4567"
        error={errors.phone?.message}
        {...form.register("phone")}
      />
      <TextField
        label={t("email")}
        type="email"
        autoComplete="email"
        aria-description={t("emailHelp")}
        error={errors.email?.message}
        {...form.register("email")}
      />
      <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
        {t("category")}
        <select className={selectClass} {...form.register("category")}>
          {MERCHANT_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {t(`categories.${value}`)}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          label={t("barangay")}
          error={errors.barangay?.message}
          {...form.register("barangay")}
        />
        <TextField label={t("city")} error={errors.city?.message} {...form.register("city")} />
      </div>
      <TextField
        label={t("addressLine")}
        autoComplete="street-address"
        error={errors.addressLine?.message}
        {...form.register("addressLine")}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-ink text-sm font-semibold">{t("pin")}</legend>
        <p className="text-ink-muted text-sm">{t("pinHelp")}</p>
        <Controller
          control={form.control}
          name="location"
          render={({ field }) => (
            <PinMap value={field.value} onChange={field.onChange} label={t("mapLabel")} />
          )}
        />
        <Button variant="secondary" onClick={locate} disabled={locating} className="self-start">
          <LocateFixed aria-hidden className="size-5" />
          {locating ? t("locating") : t("useMyLocation")}
        </Button>
      </fieldset>
      {/* Honeypot: hidden from people and assistive tech; bots fill it in. */}
      <input
        type="text"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="hidden"
        {...form.register("website")}
      />
      <FormError message={error} />
      <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
