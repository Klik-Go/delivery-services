import type { Metadata } from "next";
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
    <main className="mx-auto flex w-full max-w-screen-sm flex-col gap-4 px-4 py-4 lg:grid lg:max-w-screen-lg lg:grid-cols-[1fr_22rem] lg:items-start">
      <div className="flex flex-col gap-4">
        <h1 className="text-document text-ink">{t("title")}</h1>
        <CartView dropoff={location?.location ?? null} />
      </div>
    </main>
  );
}
