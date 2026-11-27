"use client";

import { DeskShell, type DeskNavGroup } from "@/components/ops/desk-shell";
import { useTranslations } from "next-intl";
import type { JSX, ReactNode } from "react";

/** Desk chrome: ink masthead + grouped index rail (disclosure below lg). */
export function ConsoleNav({
  isAdmin,
  title,
  signOutLabel,
  children,
}: {
  readonly isAdmin: boolean;
  readonly title: string;
  readonly signOutLabel: string;
  readonly children: ReactNode;
}): JSX.Element {
  const t = useTranslations("Ops.nav");
  const groups: DeskNavGroup[] = [
    {
      heading: t("label"),
      entries: [
        { href: "/admin", label: t("live") },
        { href: "/admin/riders", label: t("riders") },
        { href: "/admin/tickets", label: t("tickets") },
        { href: "/admin/finance", label: t("finance") },
        { href: "/admin/zones", label: t("zones") },
        { href: "/admin/stores", label: t("stores") },
        { href: "/admin/merchants", label: t("applications") },
      ],
    },
  ];
  if (isAdmin) {
    groups.push({
      heading: "Admin",
      entries: [
        { href: "/admin/promos", label: t("promos") },
        { href: "/admin/settings", label: t("settings") },
        { href: "/admin/staff", label: t("staff") },
        { href: "/admin/kpis", label: t("kpis") },
        { href: "/admin/invites", label: t("invites") },
        { href: "/admin/system", label: t("system") },
      ],
    });
  }
  return (
    <DeskShell title={title} groups={groups} signOutLabel={signOutLabel}>
      {children}
    </DeskShell>
  );
}
