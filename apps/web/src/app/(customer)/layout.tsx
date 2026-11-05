import type { JSX, ReactNode } from "react";
import { OfflineBanner, ServiceWorkerRegister } from "@/components/customer/pwa";
import { QueryProvider } from "@/components/query-provider";

/** Customer app (PWA): home feed, search, store pages, cart and address setup. */
export default function CustomerLayout({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <QueryProvider>
      <OfflineBanner />
      <ServiceWorkerRegister />
      {children}
    </QueryProvider>
  );
}
