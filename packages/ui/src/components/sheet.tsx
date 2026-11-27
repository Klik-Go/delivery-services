import type { HTMLAttributes, JSX, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface SheetProps extends HTMLAttributes<HTMLElement> {
  readonly as?: "section" | "article" | "div" | "aside";
  readonly children: ReactNode;
}

/**
 * White panel on the canvas floor: 10px corners, hairline rule, quiet panel shadow.
 * Replaces `border-2 border-brand-100` cards.
 */
export function Sheet({
  as: Tag = "section",
  className,
  children,
  ...props
}: SheetProps): JSX.Element {
  return (
    <Tag
      className={cn("rounded-panel border-rule bg-sheet text-ink shadow-panel border", className)}
      {...props}
    >
      {children}
    </Tag>
  );
}

export interface SheetSectionProps extends HTMLAttributes<HTMLDivElement> {
  readonly first?: boolean;
  readonly children: ReactNode;
}

/** Internal section with px-4 py-5; top hairline suppressed on the first. */
export function SheetSection({
  first = false,
  className,
  children,
  ...props
}: SheetSectionProps): JSX.Element {
  return (
    <div className={cn("px-4 py-5", !first && "border-rule border-t", className)} {...props}>
      {children}
    </div>
  );
}

export interface TotalRowProps extends HTMLAttributes<HTMLDivElement> {
  readonly label: string;
  readonly amount: ReactNode;
}

/** Total row: 2px ink top rule, mono amount right-aligned. */
export function TotalRow({ label, amount, className, ...props }: TotalRowProps): JSX.Element {
  return (
    <div
      className={cn(
        "border-ink text-body flex items-center justify-between border-t-2 pt-3 font-semibold",
        className,
      )}
      {...props}
    >
      <span>{label}</span>
      <span className="font-mono tabular-nums">{amount}</span>
    </div>
  );
}
