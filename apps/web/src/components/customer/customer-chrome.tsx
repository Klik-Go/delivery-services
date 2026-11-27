"use client";

import { BrandLogo, BottomNav, Button, Masthead, SkipLink } from "@klikgo/ui";
import { Home, Receipt, Search, ShoppingBag, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { JSX, ReactNode } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { useCart } from "@/lib/cart-store";
import { useHydrated } from "@/lib/use-hydrated";

const TAB_PATHS = {
  home: "/",
  search: "/search",
  orders: "/orders",
  account: "/account",
} as const;

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/s/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Compact ink masthead + bottom tab bar for the customer PWA. */
export function CustomerChrome({
  children,
  locationLabel,
  signedIn = false,
  who = null,
}: {
  readonly children: ReactNode;
  readonly locationLabel?: string | null | undefined;
  readonly signedIn?: boolean;
  readonly who?: string | null | undefined;
}): JSX.Element {
  const t = useTranslations("Customer.tabs");
  const tHome = useTranslations("Home");
  const pathname = usePathname() ?? "/";
  const hydrated = useHydrated();
  const { lines } = useCart();
  const cartCount = hydrated ? lines.reduce((sum, line) => sum + line.quantity, 0) : 0;

  const items = [
    {
      href: TAB_PATHS.home,
      label: t("home"),
      icon: <Home aria-hidden className="size-4" />,
      current: isCurrent(pathname, TAB_PATHS.home),
    },
    {
      href: TAB_PATHS.search,
      label: t("search"),
      icon: <Search aria-hidden className="size-4" />,
      current: isCurrent(pathname, TAB_PATHS.search),
    },
    {
      href: TAB_PATHS.orders,
      label: t("orders"),
      icon: <Receipt aria-hidden className="size-4" />,
      current: isCurrent(pathname, TAB_PATHS.orders),
    },
    {
      href: TAB_PATHS.account,
      label: t("account"),
      icon: <UserRound aria-hidden className="size-4" />,
      current: isCurrent(pathname, TAB_PATHS.account),
    },
  ];

  const hideChrome =
    pathname.startsWith("/checkout") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/join") ||
    pathname.startsWith("/consent");

  if (hideChrome) {
    return <>{children}</>;
  }

  return (
    <div className="bg-canvas text-ink min-h-dvh">
      <SkipLink label={t("skip")} />
      <Masthead
        density="compact"
        brand={
          <Link href="/" className="flex items-center gap-2">
            {/* Named logo for health/a11y; h1 Lilita wordmark is the lockup exception. */}
            <BrandLogo size={36} />
            <h1 className="font-display text-accent text-2xl leading-none tracking-wide">
              {tHome("brand")}
            </h1>
          </Link>
        }
        meta={
          locationLabel ? (
            <span className="text-masthead-muted text-record max-w-28 truncate tracking-normal normal-case">
              {locationLabel}
            </span>
          ) : null
        }
        actions={
          <div className="flex items-center gap-1">
            {signedIn ? (
              <SignOutButton
                label={tHome("signOut")}
                variant="ghost"
                className="text-masthead-ink hover:text-masthead-ink hover:bg-white/10"
              />
            ) : (
              <Button asChild variant="ghost" className="text-masthead-ink hover:bg-white/10">
                <Link href="/auth/sign-in">{tHome("signIn")}</Link>
              </Button>
            )}
            <Link
              href="/cart"
              className="text-masthead-ink h-tap min-h-tap min-w-tap rounded-control relative inline-flex items-center justify-center px-2 hover:bg-white/10"
              aria-label={t("cart", { count: cartCount })}
            >
              <ShoppingBag aria-hidden className="size-5" />
              {cartCount > 0 ? (
                <span className="bg-accent text-ink rounded-control absolute top-1.5 right-1.5 inline-flex min-w-4 items-center justify-center px-1 font-mono text-[10px] font-semibold tabular-nums">
                  {cartCount}
                </span>
              ) : null}
            </Link>
          </div>
        }
      />
      {signedIn && who ? (
        <p className="bg-masthead text-masthead-muted border-masthead-muted/20 text-record truncate border-t px-4 pb-2">
          {tHome("signedInAs", { who })}
        </p>
      ) : null}
      <div id="main" className="pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
        {children}
      </div>
      <BottomNav
        items={items}
        renderLink={(item, className) => (
          <Link
            href={item.href}
            className={className}
            aria-current={item.current ? "page" : undefined}
          >
            <span aria-hidden>{item.icon}</span>
            <span className="truncate">{item.label}</span>
          </Link>
        )}
      />
    </div>
  );
}
