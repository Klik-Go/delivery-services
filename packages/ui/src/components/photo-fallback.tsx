import type { JSX } from "react";
import { cn } from "../lib/cn";

export interface PhotoFallbackProps {
  /** Store or dish name — used to derive a stable initial. */
  readonly name: string;
  readonly className?: string | undefined;
}

/**
 * Designed photo placeholder when a merchant cover or dish image is missing.
 * Not a raw brand-100 letter tile: soft canvas wash, ink initial, subtle rule.
 */
export function PhotoFallback({ name, className }: PhotoFallbackProps): JSX.Element {
  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  return (
    <div
      aria-hidden
      className={cn(
        "from-canvas to-action-wash text-ink-muted flex size-full items-center justify-center bg-gradient-to-br",
        className,
      )}
    >
      <span className="text-document font-semibold select-none">{initial}</span>
    </div>
  );
}
