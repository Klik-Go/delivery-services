/**
 * Klik Go design tokens. The brand is the KGo logo (docs/BRAND.md): Open Color blue 6 (#228be6)
 * with yellow 4 (#ffd43b) lettering in Lilita One. Scales follow Open Color, the palette the logo
 * was drawn with. `tailwind/tokens.css` is what Tailwind reads; this file exposes the same values
 * to TypeScript (theme colour, icons). A unit test keeps the two in sync and checks contrast.
 */
export const BRAND_COLORS = {
  blue50: "#e7f5ff",
  blue100: "#d0ebff",
  blue200: "#a5d8ff",
  blue300: "#74c0fc",
  blue400: "#4dabf7",
  blue500: "#339af0",
  blue600: "#228be6",
  blue700: "#1c7ed6",
  blue800: "#1971c2",
  blue900: "#1864ab",
  yellow50: "#fff9db",
  yellow100: "#fff3bf",
  yellow200: "#ffec99",
  yellow300: "#ffe066",
  yellow400: "#ffd43b",
  yellow500: "#fcc419",
  yellow600: "#fab005",
  yellow700: "#f59f00",
  yellow800: "#f08c00",
  yellow900: "#e67700",
  ink: "#0b1f33",
  inkMuted: "#4a5a6a",
  surface: "#ffffff",
  surfaceMuted: "#f1f5f9",
} as const;

/** Logo background blue. Large surfaces, icons, focus rings; not for small text on white. */
export const LOGO_BLUE = BRAND_COLORS.blue600;

/** Logo lettering yellow. Highlights and badges with ink text; never small text on white. */
export const LOGO_YELLOW = BRAND_COLORS.yellow400;

/**
 * Blue for primary buttons and links. The logo blue gives white text only 3.6:1, so actions
 * use the darker step (5.0:1, WCAG AA).
 */
export const ACTION_COLOR = BRAND_COLORS.blue800;

/** Colour for `<meta name="theme-color">` and the PWA manifest (browser chrome matches the logo). */
export const THEME_COLOR = LOGO_BLUE;

/** Minimum tap target in CSS px (docs/BUILD_PLAN.md §3). */
export const MIN_TAP_TARGET_PX = 44;

/** Smallest viewport we design for, in CSS px. */
export const MOBILE_BASE_WIDTH_PX = 360;

export type BrandColorName = keyof typeof BRAND_COLORS;
