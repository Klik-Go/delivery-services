import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { CartView } from "@/components/customer/cart-view";
import { readDeliveryLocation } from "@/server/customer/location";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Customer.cart"))("title") };
}

/** The cart, priced by the server for the delivery pin. */
export default async function CartPage(): Promise<JSX.Element> {
  const [t, location] = await Promise.all([
    getTranslations("Customer.cart"),
    readDeliveryLocation(),
  ]);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col gap-4 px-4 py-4">
      <div className="flex items-center gap-2">
        <Link
          href="/"
          aria-label="Klik Go"
          className="text-brand-800 min-h-tap min-w-tap grid place-items-center"
        >
          <ChevronLeft aria-hidden className="size-6" />
        </Link>
        <h1 className="text-ink text-2xl font-bold">{t("title")}</h1>
      </div>
      <CartView dropoff={location?.location ?? null} />
    </main>
  );
}
