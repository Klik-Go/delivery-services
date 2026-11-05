import type { JSX, ReactNode } from "react";
import { QueryProvider } from "@/components/query-provider";
import { requireSurface } from "@/server/auth/guards";

/** Merchant surface: merchant owners and staff with the second factor (AAL2). */
export default async function MerchantLayout({
  children,
}: {
  readonly children: ReactNode;
}): Promise<JSX.Element> {
  await requireSurface("merchant", "/merchant");
  return <QueryProvider>{children}</QueryProvider>;
}
