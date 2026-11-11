"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { JSX } from "react";

const SECTIONS = [
  { href: "/admin", key: "live", adminOnly: false },
  { href: "/admin/riders", key: "riders", adminOnly: false },
  { href: "/admin/zones", key: "zones", adminOnly: false },
  { href: "/admin/stores", key: "stores", adminOnly: false },
  { href: "/admin/merchants", key: "applications", adminOnly: false },
  { href: "/admin/settings", key: "settings", adminOnly: true },
  { href: "/admin/staff", key: "staff", adminOnly: true },
] as const;

/** The console's sections; settings and staff are for admins only. */
export function ConsoleNav({ isAdmin }: { readonly isAdmin: boolean }): JSX.Element {
  const t = useTranslations("Ops.nav");
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")} className="-mx-4 overflow-x-auto px-4">
      <ul className="flex gap-2">
        {SECTIONS.filter((section) => isAdmin || !section.adminOnly).map((section) => {
          const current =
            section.href === "/admin"
              ? pathname === "/admin" || pathname.startsWith("/admin/orders")
              : pathname.startsWith(section.href);
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={current ? "page" : undefined}
                className={`min-h-tap inline-flex items-center rounded-full px-4 text-sm font-semibold whitespace-nowrap ${
                  current ? "bg-brand-800 text-white" : "bg-surface-muted text-ink"
                }`}
              >
                {t(section.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
