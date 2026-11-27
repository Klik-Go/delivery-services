import type { HTMLAttributes, JSX } from "react";
import { cn } from "../lib/cn";

export interface PriceProps extends HTMLAttributes<HTMLSpanElement> {
  /** Already-formatted peso string (use formatPeso from core). */
  readonly value: string;
  readonly size?: "body" | "record" | "document" | "title";
}

/** Mono tabular figure for money amounts. */
export function Price({ value, size = "body", className, ...props }: PriceProps): JSX.Element {
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        size === "body" && "text-body",
        size === "record" && "text-record",
        size === "document" && "text-document",
        size === "title" && "text-title",
        className,
      )}
      {...props}
    >
      {value}
    </span>
  );
}
