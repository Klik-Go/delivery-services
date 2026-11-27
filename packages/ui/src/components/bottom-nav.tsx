import type { JSX, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface BottomNavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly current?: boolean;
}

export interface BottomNavProps {
  readonly items: readonly BottomNavItem[];
  readonly className?: string | undefined;
  /** Render prop so apps can supply next/link without coupling packages/ui to Next. */
  readonly renderLink: (item: BottomNavItem, className: string) => ReactNode;
}

/**
 * Sheet floor bar with a top hairline. At least 44px plus safe-area inset.
 * Current tab is action colour; icon + word, never colour alone.
 */
export function BottomNav({ items, className, renderLink }: BottomNavProps): JSX.Element {
  return (
    <nav
      aria-label="Primary"
      className={cn(
        "border-rule bg-sheet fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] print:hidden",
        className,
      )}
    >
      <ul className="mx-auto flex max-w-screen-md items-stretch">
        {items.map((item) => {
          const classNameItem = cn(
            "text-label flex min-h-tap min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 font-medium",
            item.current ? "text-action" : "text-ink-muted hover:text-ink",
          );
          return (
            <li key={item.href} className="flex min-w-0 flex-1">
              {renderLink(item, classNameItem)}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
