import type { JSX, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly current?: boolean;
  readonly href?: string | undefined;
}

export interface TabsProps {
  readonly items: readonly TabItem[];
  readonly className?: string | undefined;
  readonly onSelect?: ((id: string) => void) | undefined;
  readonly renderLink?: ((item: TabItem, className: string) => ReactNode) | undefined;
}

/** Underline tabs on a hairline rule. Current tab is action; never colour alone. */
export function Tabs({ items, className, onSelect, renderLink }: TabsProps): JSX.Element {
  return (
    <div className={cn("border-rule border-b", className)} role="tablist">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {items.map((item) => {
          const classNameItem = cn(
            "text-body inline-flex h-tap min-h-tap items-center border-b-2 px-3 font-medium whitespace-nowrap transition-colors duration-150",
            item.current
              ? "border-action text-action"
              : "text-ink-muted hover:text-ink border-transparent",
          );
          return (
            <li key={item.id}>
              {renderLink ? (
                renderLink(item, classNameItem)
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={item.current === true}
                  className={classNameItem}
                  onClick={() => onSelect?.(item.id)}
                >
                  {item.label}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
