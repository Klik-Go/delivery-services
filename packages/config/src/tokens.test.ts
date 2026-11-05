import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACTION_COLOR,
  BRAND_COLORS,
  LOGO_BLUE,
  LOGO_YELLOW,
  MIN_TAP_TARGET_PX,
  THEME_COLOR,
} from "./tokens";

const css = readFileSync(fileURLToPath(new URL("../tailwind/tokens.css", import.meta.url)), "utf8");

/** blue600 → --color-brand-600, yellow400 → --color-accent-400, inkMuted → --color-ink-muted. */
function cssVariableFor(name: string): string {
  const scale = /^(blue|yellow)(\d+)$/.exec(name);
  if (scale) return `--color-${scale[1] === "blue" ? "brand" : "accent"}-${scale[2]}`;
  return `--color-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe("design tokens", () => {
  it("uses the exact colours of the KGo logo", () => {
    expect(LOGO_BLUE).toBe("#228be6");
    expect(LOGO_YELLOW).toBe("#ffd43b");
    expect(THEME_COLOR).toBe(LOGO_BLUE);
  });

  it.each(Object.entries(BRAND_COLORS))(
    "keeps %s identical in TS and Tailwind CSS",
    (name, value) => {
      expect(css).toContain(`${cssVariableFor(name)}: ${value};`);
    },
  );

  it("makes white text on primary buttons pass WCAG AA (4.5:1)", () => {
    expect(contrast("#ffffff", ACTION_COLOR)).toBeGreaterThanOrEqual(4.5);
  });

  it("makes ink text on the brand yellow pass WCAG AA", () => {
    expect(contrast(BRAND_COLORS.ink, LOGO_YELLOW)).toBeGreaterThanOrEqual(4.5);
  });

  it("lets the yellow wordmark sit on the action blue as large text (3:1)", () => {
    expect(contrast(LOGO_YELLOW, ACTION_COLOR)).toBeGreaterThanOrEqual(3);
  });

  it("keeps the logo blue usable for focus rings and icons on white (3:1)", () => {
    expect(contrast(LOGO_BLUE, BRAND_COLORS.surface)).toBeGreaterThanOrEqual(3);
  });

  it("keeps body text readable on every surface", () => {
    for (const surface of [BRAND_COLORS.surface, BRAND_COLORS.surfaceMuted, BRAND_COLORS.blue50]) {
      expect(contrast(BRAND_COLORS.ink, surface)).toBeGreaterThanOrEqual(7);
      expect(contrast(BRAND_COLORS.inkMuted, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("matches the 44px minimum tap target", () => {
    expect(MIN_TAP_TARGET_PX).toBe(44);
    expect(css).toContain("--spacing-tap: 2.75rem;");
  });

  it("uses Lilita One (the logo typeface) for display text", () => {
    expect(css).toMatch(/--font-display: var\(--font-lilita-one, "Lilita One"\)/);
  });
});
