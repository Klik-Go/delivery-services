import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { SearchView } from "@/components/customer/search-view";
import { readDeliveryLocation } from "@/server/customer/location";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Customer.search"))("title") };
}

/** Search dishes and stores near the delivery pin. */
export default async function SearchPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const [t, location, params] = await Promise.all([
    getTranslations("Customer.search"),
    readDeliveryLocation(),
    searchParams,
  ]);
  const category = typeof params.category === "string" ? params.category : null;
  return (
    <main className="mx-auto flex w-full max-w-screen-md flex-col gap-4 px-4 py-4">
      <h1 className="text-document text-ink">{t("title")}</h1>
      <SearchView hasLocation={location !== null} initialCategory={category} />
    </main>
  );
}
