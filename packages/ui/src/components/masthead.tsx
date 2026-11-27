import type { JSX, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface MastheadProps {
  /** Brand lockup (BrandLogo + optional wordmark). */
  readonly brand: ReactNode;
  /** System title beside the lockup (Inter, not Lilita). */
  readonly title?: string | undefined;
  /** Optional mono issue / cart / earnings count. */
  readonly meta?: ReactNode;
  readonly actions?: ReactNode;
  /** Compact phone portal vs full desk band. */
  readonly density?: "compact" | "desk";
  readonly className?: string | undefined;
  readonly children?: ReactNode;
}

/**
 * Ink institutional band. Put a skip-to-content link as the first focusable child of the page;
 * the masthead itself carries brand, title, and optional meta.
 */
export function Masthead({
  brand,
  title,
  meta,
  actions,
  density = "compact",
  className,
  children,
}: MastheadProps): JSX.Element {
  return (
    <header
      className={cn(
        "bg-masthead text-masthead-ink print:hidden",
        density === "compact" ? "px-4 py-3" : "px-6 py-3",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {brand}
          {title ? (
            <div className="min-w-0">
              <p className="text-mark text-masthead-muted uppercase">Klik Go</p>
              <p className="text-title truncate">{title}</p>
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {meta ? <div className="text-record font-mono tabular-nums">{meta}</div> : null}
          {actions}
        </div>
      </div>
      {children}
    </header>
  );
}

export interface SkipLinkProps {
  readonly href?: string;
  readonly label: string;
}

/** First focus stop. Heavier overlay shadow reserved for this control. */
export function SkipLink({ href = "#main", label }: SkipLinkProps): JSX.Element {
  return (
    <a
      href={href}
      className="bg-action text-body focus:shadow-overlay rounded-control sr-only px-4 py-2 font-semibold text-white focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
    >
      {label}
    </a>
  );
}
