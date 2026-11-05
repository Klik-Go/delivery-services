/**
 * Klik Go design tokens (docs/BUSINESS.md §4.1: bold blue/teal, clean sans, map-pin motif).
 * `tailwind/tokens.css` is what Tailwind reads; this file exposes the same values to
 * TypeScript (e.g. the PWA theme colour). A unit test keeps the two in sync.
 */
export const BRAND_COLORS = {
  teal50: "#effcfa",
  teal100: "#c8f5ef",
  teal500: "#14b8a6",
  teal600: "#0d9488",
  teal700: "#0f766e",
  teal800: "#115e59",
  teal900: "#134e4a",
  blue500: "#2563eb",
  blue600: "#1d4ed8",
  blue700: "#1e40af",
  ink: "#0b1f24",
  inkMuted: "#47606a",
  surface: "#ffffff",
  surfaceMuted: "#f3f7f7",
} as const;

/** Colour used for `<meta name="theme-color">` and the PWA manifest. */
export const THEME_COLOR = BRAND_COLORS.teal700;

/** Minimum tap target in CSS px (docs/BUILD_PLAN.md §3). */
export const MIN_TAP_TARGET_PX = 44;

/** Smallest viewport we design for, in CSS px. */
export const MOBILE_BASE_WIDTH_PX = 360;

export type BrandColorName = keyof typeof BRAND_COLORS;
