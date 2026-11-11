import type { JSX, ReactNode } from "react";
import { ServiceWorkerRegister } from "@/components/customer/pwa";
import { QueryProvider } from "@/components/query-provider";
import { requireSurface } from "@/server/auth/guards";

/** Rider surface: signed-in riders (phone OTP). */
export default async function RiderLayout({
  children,
}: {
  readonly children: ReactNode;
}): Promise<JSX.Element> {
  await requireSurface("rider", "/rider");
  // The service worker shows job offers (Web Push) and keeps the app installable as a PWA.
  return (
    <QueryProvider>
      <ServiceWorkerRegister />
      {children}
    </QueryProvider>
  );
}
