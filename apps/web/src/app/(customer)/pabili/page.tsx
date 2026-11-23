import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { PabiliForm, type PabiliAddressDraft } from "@/components/pabili/pabili-form";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { readDeliveryLocation } from "@/server/customer/location";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Pabili.form"))("title") };
}

/** Pabili: send a shopping list for any shop; a rider buys it and you pay in cash at the door. */
export default async function PabiliPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect("/auth/sign-in?next=/pabili");
  const container = getContainer();
  const [t, options, location, saved] = await Promise.all([
    getTranslations("Pabili.form"),
    container.pabili.options(),
    readDeliveryLocation(),
    container.addresses.list(user),
  ]);
  const addresses = saved.ok ? saved.value : [];
  const preferred = addresses.find((a) => a.isDefault) ?? addresses[0];
  const address: PabiliAddressDraft = {
    label: preferred?.label ?? location?.label ?? "Home",
    street: preferred?.street ?? "",
    landmark: preferred?.landmark ?? "",
    barangay: preferred?.barangay ?? "",
    city: preferred?.city ?? "",
    notes: preferred?.notes ?? "",
    contactPhone: preferred?.contactPhone ?? user.phone ?? "",
  };
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col gap-4 px-4 py-4">
      <div className="flex items-center gap-2">
        <Link
          href="/"
          aria-label={t("back")}
          className="text-brand-800 min-h-tap min-w-tap grid place-items-center"
        >
          <ChevronLeft aria-hidden className="size-6" />
        </Link>
        <h1 className="text-ink text-2xl font-bold">{t("title")}</h1>
      </div>
      <p className="text-ink-muted">{t("lead")}</p>
      {options.enabled ? (
        <PabiliForm
          options={options}
          dropoff={location?.location ?? preferred?.location ?? null}
          initialAddress={address}
        />
      ) : (
        <p className="text-ink" data-testid="pabili-off">
          {t("off")}
        </p>
      )}
    </main>
  );
}
