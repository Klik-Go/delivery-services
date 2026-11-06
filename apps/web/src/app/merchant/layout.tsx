import type { JSX, ReactNode } from "react";
import { ServiceWorkerRegister } from "@/components/customer/pwa";
import { QueryProvider } from "@/components/query-provider";
import { requireSurface } from "@/server/auth/guards";

/** Merchant surface: merchant owners and staff with the second factor (AAL2). */
export default async function MerchantLayout({
  children,
}: {
  readonly children: ReactNode;
}): Promise<JSX.Element> {
  await requireSurface("merchant", "/merchant");
  // The service worker shows order alerts (Web Push) on the store's devices.
  return (
    <QueryProvider>
      <ServiceWorkerRegister />
      {children}
    </QueryProvider>
  );
}
