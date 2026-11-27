import type { JSX, ReactNode } from "react";
import { CustomerChrome } from "@/components/customer/customer-chrome";
import { OfflineBanner, ServiceWorkerRegister } from "@/components/customer/pwa";
import { QueryProvider } from "@/components/query-provider";
import { getSessionUser } from "@/server/auth/session";
import { readDeliveryLocation } from "@/server/customer/location";

/** Customer app (PWA): home feed, search, store pages, cart and address setup. */
export default async function CustomerLayout({
  children,
}: {
  readonly children: ReactNode;
}): Promise<JSX.Element> {
  const [location, user] = await Promise.all([readDeliveryLocation(), getSessionUser()]);
  return (
    <QueryProvider>
      <OfflineBanner />
      <ServiceWorkerRegister />
      <CustomerChrome
        locationLabel={location?.label ?? null}
        signedIn={user !== null}
        who={user?.phone ?? user?.email ?? null}
      >
        {children}
      </CustomerChrome>
    </QueryProvider>
  );
}
