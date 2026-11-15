import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { OrderHistory } from "@/components/retention/order-history";
import { getSessionUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Retention.history"))("title") };
}

/** The customer's orders with "Rate" and "Order again". */
export default async function OrdersPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect("/auth/sign-in?next=/orders");
  const t = await getTranslations("Retention.history");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col gap-4 px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-ink text-2xl font-bold">{t("title")}</h1>
        <Link
          href="/rewards"
          className="text-brand-800 min-h-tap inline-flex items-center font-semibold underline"
        >
          {t("rewards")}
        </Link>
      </div>
      <OrderHistory />
    </main>
  );
}
