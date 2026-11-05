import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { AddressSetup, WaitlistForm } from "@/components/customer/address-setup";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { readDeliveryLocation } from "@/server/customer/location";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Customer.address"))("title") };
}

/** Where to deliver: GPS, search or pin; out of zone → waitlist. */
export default async function AddressPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const [t, tCustomer, user, location, params] = await Promise.all([
    getTranslations("Customer.address"),
    getTranslations("Customer"),
    getSessionUser(),
    readDeliveryLocation(),
    searchParams,
  ]);
  const showWaitlist = params.waitlist === "1" && location !== null;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col gap-4 px-4 py-4">
      <Link
        href="/"
        className="text-brand-800 min-h-tap inline-flex items-center gap-1 self-start font-semibold"
      >
        <ChevronLeft aria-hidden className="size-5" />
        Klik Go
      </Link>
      <h1 className="text-ink text-2xl font-bold">{t("title")}</h1>
      <p className="text-ink-muted">{t("lead")}</p>
      {showWaitlist ? (
        <WaitlistForm pin={location.location} message={tCustomer("notInArea")} />
      ) : (
        <AddressSetup
          signedIn={user !== null}
          placesEnabled={getContainer().placesConfigured}
          initial={location?.location ?? null}
        />
      )}
    </main>
  );
}
