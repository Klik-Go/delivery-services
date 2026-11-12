import type { JSX, ReactNode } from "react";
import { QueryProvider } from "@/components/query-provider";
import { requireSurface } from "@/server/auth/guards";

/** Admin console: admins and zone coordinators with the second factor (AAL2). */
export default async function AdminLayout({
  children,
}: {
  readonly children: ReactNode;
}): Promise<JSX.Element> {
  await requireSurface("admin", "/admin");
  return <QueryProvider>{children}</QueryProvider>;
}
