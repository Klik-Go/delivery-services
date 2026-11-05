import type { JSX } from "react";
import { cn } from "../lib/cn";

/** Props for {@link BrandLogo}. */
export interface BrandLogoProps {
  readonly className?: string;
  /** Rendered size in px (square). */
  readonly size?: number;
}

/** Klik Go mark: a map pin (brand §4.1 motif) with a "go" chevron inside. */
export function BrandLogo({ className, size = 48 }: BrandLogoProps): JSX.Element {
  return (
    <svg
      role="img"
      aria-label="Klik Go logo"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={cn("shrink-0", className)}
    >
      <title>Klik Go logo</title>
      <path
        d="M24 3c-8.8 0-16 7-16 15.7C8 30.5 24 45 24 45s16-14.5 16-26.3C40 10 32.8 3 24 3Z"
        className="fill-brand-700"
      />
      <circle cx="24" cy="19" r="9" className="fill-white" />
      <path
        d="m21 14.5 5.5 4.5-5.5 4.5"
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-accent-600"
      />
    </svg>
  );
}
