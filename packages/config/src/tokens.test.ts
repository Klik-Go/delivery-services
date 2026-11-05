import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BRAND_COLORS, MIN_TAP_TARGET_PX, THEME_COLOR } from "./tokens";

const css = readFileSync(fileURLToPath(new URL("../tailwind/tokens.css", import.meta.url)), "utf8");

const CSS_VARIABLE_FOR: Record<keyof typeof BRAND_COLORS, string> = {
  teal50: "--color-brand-50",
  teal100: "--color-brand-100",
  teal500: "--color-brand-500",
  teal600: "--color-brand-600",
  teal700: "--color-brand-700",
  teal800: "--color-brand-800",
  teal900: "--color-brand-900",
  blue500: "--color-accent-500",
  blue600: "--color-accent-600",
  blue700: "--color-accent-700",
  ink: "--color-ink",
  inkMuted: "--color-ink-muted",
  surface: "--color-surface",
  surfaceMuted: "--color-surface-muted",
};

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe("design tokens", () => {
  it.each(Object.entries(CSS_VARIABLE_FOR))(
    "keeps %s identical in TS and Tailwind CSS",
    (name, cssVar) => {
      const value = BRAND_COLORS[name as keyof typeof BRAND_COLORS];
      expect(css).toContain(`${cssVar}: ${value};`);
    },
  );

  it("uses a theme colour that passes WCAG AA against white text", () => {
    expect(contrast(THEME_COLOR, BRAND_COLORS.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps body text readable on the muted surface", () => {
    expect(contrast(BRAND_COLORS.ink, BRAND_COLORS.surfaceMuted)).toBeGreaterThanOrEqual(7);
    expect(contrast(BRAND_COLORS.inkMuted, BRAND_COLORS.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("matches the 44px minimum tap target", () => {
    expect(MIN_TAP_TARGET_PX).toBe(44);
    expect(css).toContain("--spacing-tap: 2.75rem;");
  });
});
