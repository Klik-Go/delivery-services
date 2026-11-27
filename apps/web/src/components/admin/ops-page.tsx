import type { SessionUser } from "@klikgo/core";
import { getTranslations } from "next-intl/server";
import type { JSX, ReactNode } from "react";
import { requireSurface } from "@/server/auth/guards";
import { getContainer } from "@/server/container";
import { ConsoleNav } from "./console-nav";

/** Frame for every console page: desk masthead + index rail, then the page's content. */
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
  const tHome = await getTranslations("Home");
  return (
    <ConsoleNav isAdmin={isAdmin} title={title} signOutLabel={tHome("signOut")}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-document text-ink">{title}</h1>
          <p className="text-body text-ink-muted">{lead}</p>
        </div>
        {children({ user, isAdmin })}
      </div>
    </ConsoleNav>
  );
}
