import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACTION_COLOR,
  BRAND_COLORS,
  DESK_CONTROL_PX,
  LOGO_BLUE,
  LOGO_YELLOW,
  MIN_TAP_TARGET_PX,
  RADIUS_CONTROL_PX,
  RADIUS_PANEL_PX,
  THEME_COLOR,
} from "./tokens";

const css = readFileSync(fileURLToPath(new URL("../tailwind/tokens.css", import.meta.url)), "utf8");

/** blue600 → --color-brand-600, yellow400 → --color-accent-400, inkMuted → --color-ink-muted. */
function cssVariableFor(name: string): string {
  const scale = /^(blue|yellow|danger)(\d+)$/.exec(name);
  const prefix: Record<string, string> = { blue: "brand", yellow: "accent", danger: "danger" };
  if (scale) return `--color-${prefix[scale[1] ?? ""] ?? ""}-${scale[2]}`;
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

  it("maps action to brand-800, never the logo blue", () => {
    expect(ACTION_COLOR).toBe("#1971c2");
    expect(ACTION_COLOR).toBe(BRAND_COLORS.blue800);
    expect(ACTION_COLOR).not.toBe(LOGO_BLUE);
    expect(BRAND_COLORS.action).toBe(ACTION_COLOR);
  });

  it.each(Object.entries(BRAND_COLORS))(
    "keeps %s identical in TS and Tailwind CSS",
    (name, value) => {
      expect(css).toContain(`${cssVariableFor(name)}: ${value};`);
    },
  );

  it("makes white text on primary buttons pass WCAG AA (4.5:1)", () => {
    expect(contrast("#ffffff", ACTION_COLOR)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", BRAND_COLORS.actionHover)).toBeGreaterThanOrEqual(4.5);
  });

  it("makes ink text on turmeric pass WCAG AA", () => {
    expect(contrast(BRAND_COLORS.ink, LOGO_YELLOW)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(BRAND_COLORS.ink, BRAND_COLORS.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it("lets the yellow wordmark sit on the action blue as large text (3:1)", () => {
    expect(contrast(LOGO_YELLOW, ACTION_COLOR)).toBeGreaterThanOrEqual(3);
  });

  it("keeps the logo blue usable for focus rings and icons on white (3:1)", () => {
    expect(contrast(LOGO_BLUE, BRAND_COLORS.sheet)).toBeGreaterThanOrEqual(3);
  });

  it("keeps body text readable on every surface", () => {
    for (const surface of [BRAND_COLORS.sheet, BRAND_COLORS.canvas, BRAND_COLORS.actionWash]) {
      expect(contrast(BRAND_COLORS.ink, surface)).toBeGreaterThanOrEqual(7);
      expect(contrast(BRAND_COLORS.inkMuted, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps ink-faint readable for not-yet-reached steps on canvas (4.5:1)", () => {
    expect(contrast(BRAND_COLORS.inkFaint, BRAND_COLORS.canvas)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps masthead text readable", () => {
    expect(contrast(BRAND_COLORS.mastheadInk, BRAND_COLORS.masthead)).toBeGreaterThanOrEqual(7);
    expect(contrast(BRAND_COLORS.mastheadMuted, BRAND_COLORS.masthead)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps action text readable on sheet, canvas, and wash", () => {
    expect(contrast(BRAND_COLORS.action, BRAND_COLORS.sheet)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(BRAND_COLORS.action, BRAND_COLORS.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(BRAND_COLORS.action, BRAND_COLORS.actionWash)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps seal / certified / awaiting readable on their washes and on white", () => {
    expect(contrast(BRAND_COLORS.seal, BRAND_COLORS.sealWash)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(BRAND_COLORS.seal, BRAND_COLORS.sheet)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(BRAND_COLORS.certified, BRAND_COLORS.certifiedWash)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrast(BRAND_COLORS.certified, BRAND_COLORS.sheet)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(BRAND_COLORS.awaiting, BRAND_COLORS.awaitingWash)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(BRAND_COLORS.awaiting, BRAND_COLORS.sheet)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps error text readable on its tint and on white", () => {
    expect(contrast(BRAND_COLORS.danger900, BRAND_COLORS.danger50)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(BRAND_COLORS.danger900, BRAND_COLORS.sheet)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps rule-strong as a non-text AA operable stroke (3:1)", () => {
    expect(contrast(BRAND_COLORS.ruleStrong, BRAND_COLORS.canvas)).toBeGreaterThanOrEqual(3);
    expect(contrast(BRAND_COLORS.ruleStrong, BRAND_COLORS.sheet)).toBeGreaterThanOrEqual(3);
  });

  it("matches the 44px PWA and 36px desk control heights", () => {
    expect(MIN_TAP_TARGET_PX).toBe(44);
    expect(DESK_CONTROL_PX).toBe(36);
    expect(css).toContain("--spacing-tap: 2.75rem;");
    expect(css).toContain("--spacing-control: 2.25rem;");
  });

  it("uses 6px control and 10px panel radii", () => {
    expect(RADIUS_CONTROL_PX).toBe(6);
    expect(RADIUS_PANEL_PX).toBe(10);
    expect(css).toContain("--radius-control: 6px;");
    expect(css).toContain("--radius-panel: 10px;");
  });

  it("uses Inter for UI and JetBrains Mono for figures", () => {
    expect(css).toMatch(/--font-sans: var\(--font-inter, "Inter"\)/);
    expect(css).toMatch(/--font-mono:\s*\n?\s*var\(--font-jetbrains-mono, "JetBrains Mono"\)/);
  });

  it("uses Lilita One (the logo typeface) for display text", () => {
    expect(css).toMatch(/--font-display: var\(--font-lilita-one, "Lilita One"\)/);
  });

  it("defines a .dark role restatement for a later ship", () => {
    expect(css).toContain(".dark {");
    expect(css).toContain("color-scheme: dark;");
  });
});
