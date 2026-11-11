import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { z } from "zod";
import { OpsPage } from "@/components/admin/ops-page";
import { OrderDetail } from "@/components/admin/order-detail";

export const dynamic = "force-dynamic";

/** One order in the console: history, notes, rider assignment, cancel and refund. */
export default async function AdminOrderPage({
  params,
}: {
  readonly params: Promise<{ orderId: string }>;
}): Promise<JSX.Element> {
  const { orderId } = await params;
  if (!z.uuid().safeParse(orderId).success) notFound();
  const t = await getTranslations("Ops.board");
  return (
    <OpsPage path={`/admin/orders/${orderId}`} title={t("title")} lead="">
      {() => <OrderDetail orderId={orderId} />}
    </OpsPage>
  );
}
