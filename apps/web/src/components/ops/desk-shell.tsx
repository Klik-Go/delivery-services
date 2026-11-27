"use client";

import {
  BrandLogo,
  IndexRail,
  IndexRailDisclosure,
  Masthead,
  SkipLink,
  type IndexRailEntry,
  type IndexRailGroup,
} from "@klikgo/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { JSX, ReactNode } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";

export interface DeskNavEntry {
  readonly href: string;
  readonly label: string;
  readonly current?: boolean;
  readonly count?: string | number | undefined;
}

export interface DeskNavGroup {
  readonly heading: string;
  readonly entries: readonly DeskNavEntry[];
}

/** Ink masthead + 16rem index rail (disclosure below lg) for coordinator/admin and merchant desk. */
export function DeskShell({
  title,
  groups,
  children,
  signOutLabel,
}: {
  readonly title: string;
  readonly groups: readonly DeskNavGroup[];
  readonly children: ReactNode;
  readonly signOutLabel: string;
}): JSX.Element {
  const pathname = usePathname() ?? "/";
  const railGroups: IndexRailGroup[] = groups.map((group) => ({
    heading: group.heading,
    entries: group.entries.map((entry) => ({
      ...entry,
      current:
        entry.current ??
        (entry.href === "/admin" || entry.href === "/merchant"
          ? pathname === entry.href || pathname.startsWith(`${entry.href}/orders`)
          : pathname === entry.href || pathname.startsWith(`${entry.href}/`)),
    })),
  }));

  const renderLink = (entry: IndexRailEntry, className: string): ReactNode => (
    <Link href={entry.href} className={className} aria-current={entry.current ? "page" : undefined}>
      <span className="truncate">{entry.label}</span>
      {entry.count !== undefined ? (
        <span className="text-record font-mono tabular-nums">{entry.count}</span>
      ) : null}
    </Link>
  );

  return (
    <div className="bg-canvas text-ink flex min-h-dvh flex-col">
      <SkipLink label="Skip to content" />
      <Masthead
        density="desk"
        brand={
          <Link href="/" className="flex items-center gap-2">
            <BrandLogo size={36} decorative />
            <span className="font-display text-accent text-2xl tracking-wide">Klik Go</span>
          </Link>
        }
        title={title}
        actions={
          <SignOutButton
            label={signOutLabel}
            variant="ghost"
            className="text-masthead-ink hover:text-masthead-ink hover:bg-white/10"
          />
        }
      >
        <div className="mt-2 lg:hidden">
          <IndexRailDisclosure label="Menu" groups={railGroups} renderLink={renderLink} />
        </div>
      </Masthead>
      <div className="flex min-h-0 flex-1">
        <IndexRail groups={railGroups} renderLink={renderLink} />
        <main id="main" className="min-w-0 flex-1 px-4 py-4 lg:px-6 lg:py-5">
          {children}
        </main>
      </div>
    </div>
  );
}
