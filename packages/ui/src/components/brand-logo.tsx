import type { JSX } from "react";
import { cn } from "../lib/cn";
import { LOGO_LETTERING, LOGO_TILE_FILL, LOGO_TILE_OUTLINE } from "./brand-logo-paths";

const VIEW_BOX = { x: 8, y: 8, width: 194.12, height: 190.53 } as const;

/** Props for {@link BrandLogo}. */
export interface BrandLogoProps {
  readonly className?: string;
  /** Rendered width in px; height keeps the logo's aspect ratio. */
  readonly size?: number;
  /** Hide from screen readers when a visible "Klik Go" name is right next to the logo. */
  readonly decorative?: boolean;
}

/** The KGo logo (docs/BRAND.md): a hand-drawn logo-blue tile with yellow Lilita One lettering. */
export function BrandLogo({
  className,
  size = 48,
  decorative = false,
}: BrandLogoProps): JSX.Element {
  const height = Math.round((size * VIEW_BOX.height) / VIEW_BOX.width);
  const a11y = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": "Klik Go logo" } as const);
  return (
    <svg
      {...a11y}
      width={size}
      height={height}
      viewBox={`${VIEW_BOX.x} ${VIEW_BOX.y} ${VIEW_BOX.width} ${VIEW_BOX.height}`}
      className={cn("shrink-0", className)}
    >
      {decorative ? null : <title>Klik Go logo</title>}
      <g transform="translate(10 10)" strokeLinecap="round">
        <path d={LOGO_TILE_FILL} className="fill-brand-600" />
        <path d={LOGO_TILE_OUTLINE} fill="none" strokeWidth={2} className="stroke-brand-600" />
      </g>
      <path d={LOGO_LETTERING} className="fill-accent-400" />
    </svg>
  );
}
