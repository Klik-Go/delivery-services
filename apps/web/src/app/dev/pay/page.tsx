import { formatPeso } from "@klikgo/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import { FakePayButtons } from "@/components/customer/fake-pay-buttons";
import { getContainer } from "@/server/container";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Test checkout", robots: { index: false } };

/**
 * Local stand-in for PayMongo's hosted checkout (PAYMENT_GATEWAY=fake only; 404 otherwise).
 */
export default async function DevPayPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const fake = getContainer().fakeCheckout;
  if (!fake) notFound();
  const [t, tStatus, params] = await Promise.all([
    getTranslations("Customer.devPay"),
    getTranslations("Customer.order.status"),
    searchParams,
  ]);
  const sessionId = typeof params.session === "string" ? params.session : "";
  const session = /^[A-Za-z0-9_-]{1,120}$/.test(sessionId) ? await fake.session(sessionId) : null;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col gap-4 px-4 py-6">
      <h1 className="text-ink text-2xl font-bold">{t("title")}</h1>
      <p className="bg-accent-400 text-ink rounded-xl p-3 font-semibold">{t("banner")}</p>
      {!session ? (
        <p className="text-ink">{t("missing")}</p>
      ) : (
        <>
          <p className="text-ink text-lg">
            {session.code} · {t("amount")}: <strong>{formatPeso(session.amountCentavos)}</strong>
          </p>
          {session.orderStatus === "awaiting_payment" ? (
            <FakePayButtons
              session={sessionId}
              orderId={session.orderId}
              payLabel={t("pay", { total: formatPeso(session.amountCentavos) })}
              cancelLabel={t("cancel")}
              failedMessage={t("failed")}
            />
          ) : (
            <p className="text-ink">{t("done", { status: tStatus(session.orderStatus) })}</p>
          )}
        </>
      )}
    </main>
  );
}
