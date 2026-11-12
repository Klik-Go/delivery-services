import type { JSX, ReactNode } from "react";
import { SurfaceShell } from "@/components/surface-shell";
import { requireSurface } from "@/server/auth/guards";
import { getContainer } from "@/server/container";
import { ConsoleNav } from "./console-nav";
import type { SessionUser } from "@klikgo/core";

/** Frame for every console page: header, section navigation, then the page's content. */
export async function OpsPage({
  path,
  title,
  lead,
  children,
}: {
  readonly path: string;
  readonly title: string;
  readonly lead: string;
  readonly children: (context: { user: SessionUser; isAdmin: boolean }) => ReactNode;
}): Promise<JSX.Element> {
  const user = await requireSurface("admin", path);
  const isAdmin = getContainer().authz.can(user, { type: "ops.platform" });
  return (
    <SurfaceShell title={title} lead={lead} who={user.email ?? user.id}>
      <ConsoleNav isAdmin={isAdmin} />
      {children({ user, isAdmin })}
    </SurfaceShell>
  );
}
