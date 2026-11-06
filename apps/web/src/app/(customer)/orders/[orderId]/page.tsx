import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { z } from "zod";
import { OrderStatusView } from "@/components/customer/order-status-view";
import { getSessionUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Customer.order"))("loading") };
}

/** One order: its status and payment, refreshed while it changes. */
export default async function OrderPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ orderId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const [{ orderId }, query, user] = await Promise.all([params, searchParams, getSessionUser()]);
  if (!z.uuid().safeParse(orderId).success) notFound();
  if (!user) redirect(`/auth/sign-in?next=${encodeURIComponent(`/orders/${orderId}`)}`);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col gap-4 px-4 py-4">
      <OrderStatusView
        orderId={orderId}
        returned={query.paid === "1" ? "paid" : query.cancelled === "1" ? "cancelled" : null}
      />
    </main>
  );
}
