/**
 * Klik Go design tokens. The brand is the KGo logo (docs/BRAND.md): Open Color blue 6 (#228be6)
 * with yellow 4 (#ffd43b) lettering in Lilita One. Scales follow Open Color. Role tokens map those
 * colours onto the operations-room UI language (ink, canvas, sheet, action, masthead, status).
 * `tailwind/tokens.css` is what Tailwind reads; this file exposes the same values to TypeScript
 * (theme colour, icons, contrast tests). A unit test keeps the two in sync.
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
  danger50: "#fff5f5",
  danger900: "#c92a2a",
  ink: "#0b1f33",
  inkMuted: "#4a5a6a",
  inkFaint: "#647186",
  canvas: "#f1f5f9",
  sheet: "#ffffff",
  sheetAlt: "#f7f9fc",
  rule: "#d5dee8",
  ruleStrong: "#6b8499",
  masthead: "#0b1f33",
  mastheadInk: "#ffffff",
  mastheadMuted: "#a8c4dc",
  action: "#1971c2",
  actionHover: "#1864ab",
  actionWash: "#e7f5ff",
  seal: "#c92a2a",
  sealWash: "#fff5f5",
  certified: "#16734a",
  certifiedWash: "#eaf8f0",
  awaiting: "#8a5a00",
  awaitingWash: "#fff9db",
  accent: "#ffd43b",
  /** @deprecated Prefer `sheet`. Kept for migration. */
  surface: "#ffffff",
  /** @deprecated Prefer `canvas`. Kept for migration. */
  surfaceMuted: "#f1f5f9",
} as const;

/** Logo background blue. Large surfaces, icons, PWA theme-color; not for small text on white. */
export const LOGO_BLUE = BRAND_COLORS.blue600;

/** Logo lettering yellow. Highlights and badges with ink text; never small text on white. */
export const LOGO_YELLOW = BRAND_COLORS.yellow400;

/**
 * Blue for primary buttons and links. The logo blue gives white text only 3.6:1, so actions
 * use the darker step (5.0:1, WCAG AA). Same as `BRAND_COLORS.action`.
 */
export const ACTION_COLOR = BRAND_COLORS.action;

/** Colour for `<meta name="theme-color">` and the PWA manifest (browser chrome matches the logo). */
export const THEME_COLOR = LOGO_BLUE;

/** Masthead / institutional band. Same as ink. */
export const MASTHEAD_COLOR = BRAND_COLORS.masthead;

/** Minimum tap target in CSS px for phone-first surfaces (docs/BUILD_PLAN.md §3). */
export const MIN_TAP_TARGET_PX = 44;

/** Dense desk control height in CSS px (from `lg` up on coordinator/admin). */
export const DESK_CONTROL_PX = 36;

/** Smallest viewport we design for, in CSS px. */
export const MOBILE_BASE_WIDTH_PX = 360;

/** Control corner radius in CSS px. */
export const RADIUS_CONTROL_PX = 6;

/** Panel corner radius in CSS px. */
export const RADIUS_PANEL_PX = 10;

export type BrandColorName = keyof typeof BRAND_COLORS;
