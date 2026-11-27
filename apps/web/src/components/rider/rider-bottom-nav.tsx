"use client";

import { BottomNav } from "@klikgo/ui";
import { Banknote, Home } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { JSX } from "react";

/** Rider PWA floor tabs: Home + Earnings. Current tab is action colour (icon + word). */
export function RiderBottomNav(): JSX.Element {
  const t = useTranslations("Rider.tabs");
  const pathname = usePathname() ?? "/rider";
  const items = [
    {
      href: "/rider",
      label: t("home"),
      icon: <Home aria-hidden className="size-4" />,
      current: pathname === "/rider",
    },
    {
      href: "/rider/payouts",
      label: t("earnings"),
      icon: <Banknote aria-hidden className="size-4" />,
      current: pathname.startsWith("/rider/payouts"),
    },
  ];
  return (
    <BottomNav
      items={items}
      renderLink={(item, className) => (
        <Link
          href={item.href}
          className={className}
          title={item.label}
          aria-current={item.current ? "page" : undefined}
        >
          <span aria-hidden>{item.icon}</span>
          <span className="truncate">{item.label}</span>
        </Link>
      )}
    />
  );
}
