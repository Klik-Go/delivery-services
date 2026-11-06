import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { CheckoutView, type CheckoutAddressDraft } from "@/components/customer/checkout-view";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { readDeliveryLocation } from "@/server/customer/location";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Customer.checkout"))("title") };
}

/** Single-screen checkout: address, time, payment, promo, tip, then "Place order". */
export default async function CheckoutPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect("/auth/sign-in?next=/checkout");
  const [t, location, saved] = await Promise.all([
    getTranslations("Customer.checkout"),
    readDeliveryLocation(),
    getContainer().addresses.list(user),
  ]);
  const addresses = saved.ok ? saved.value : [];
  const preferred = addresses.find((a) => a.isDefault) ?? addresses[0];
  const address: CheckoutAddressDraft = {
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
          href="/cart"
          aria-label={t("back")}
          className="text-brand-800 min-h-tap min-w-tap grid place-items-center"
        >
          <ChevronLeft aria-hidden className="size-6" />
        </Link>
        <h1 className="text-ink text-2xl font-bold">{t("title")}</h1>
      </div>
      <CheckoutView
        dropoff={location?.location ?? preferred?.location ?? null}
        initialAddress={address}
      />
    </main>
  );
}
