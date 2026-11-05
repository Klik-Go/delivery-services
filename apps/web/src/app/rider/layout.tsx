import type { JSX, ReactNode } from "react";
import { requireSurface } from "@/server/auth/guards";

/** Rider surface: signed-in riders (phone OTP). */
export default async function RiderLayout({
  children,
}: {
  readonly children: ReactNode;
}): Promise<JSX.Element> {
  await requireSurface("rider", "/rider");
  return <>{children}</>;
}
