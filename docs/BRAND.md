# Klik Go brand

The brand is the **KGo** logo: yellow Lilita One lettering on a hand-drawn blue tile. It was supplied by the owner on 2026-11-05 (docs/OPEN_QUESTIONS.md Q7) and replaces the Phase 0 placeholder teal pin. It implements docs/BUSINESS.md §4.1 ("bold primary colour, clean typography, friendly and local").

<img src="brand/klik-go-logo.svg" width="120" alt="Klik Go logo">

## Logo files

| File | Use |
|---|---|
| `docs/brand/klik-go-logo-source.svg` | Original Excalidraw export, kept verbatim (text uses an embedded font subset). Edit the logo from this. |
| `docs/brand/klik-go-logo-original.png` | Original PNG as supplied (210 × 207). |
| `docs/brand/klik-go-logo.svg`, `apps/web/public/brand/klik-go-logo.svg` | **Production logo.** Same artwork with the lettering converted to outlines (no font dependency) and a transparent background. |
| `apps/web/public/brand/klik-go-logo-512.png`, `docs/brand/klik-go-logo-512.png` | 512 px PNG of the production logo (social, docs, merchant materials). |
| `apps/web/src/app/icon.svg` | Browser favicon (Next.js file convention). |
| `apps/web/src/app/apple-icon.png` | iOS home-screen icon, 180 px, full-bleed blue (iOS rounds the corners itself). |
| `apps/web/public/brand/icon-192.png`, `icon-512.png` | Android / PWA icons for the Phase 4 manifest (full-bleed, maskable-safe). |
| `packages/ui/src/components/brand-logo.tsx` | `<BrandLogo />` React component. Use this in the UI; pass `decorative` when a visible "Klik Go" name sits beside it. |

Regenerating the outlines: the lettering is Lilita One at 80.26 px, shaped with HarfBuzz and converted with fontTools. The path data lives in `packages/ui/src/components/brand-logo-paths.ts`; the SVG/PNG files above are rendered from it.

Clear space: keep at least ¼ of the logo width empty around it. Minimum size: 24 px (favicon), 40 px in UI.

Don't recolour the tile or the lettering, add effects or outlines, stretch it, or set "KGo" in another font.

## Colours

Both logo colours come from [Open Color](https://yeun.github.io/open-color/) (the palette Excalidraw uses), so the full scales below are Open Color **blue** and **yellow**.

| Token (Tailwind) | Hex | Role |
|---|---|---|
| `brand-600` | `#228be6` | **Logo blue.** Logo tile, large brand surfaces, icons, focus rings, browser `theme-color`. |
| `brand-800` | `#1971c2` | **Action blue.** Primary buttons, links, hero backgrounds with white text. |
| `brand-900` | `#1864ab` | Hover/pressed state of actions. |
| `brand-50`–`brand-500`, `brand-700` | Open Color blue 0–5, 7 | Tints for backgrounds, selected states, charts. |
| `accent-400` | `#ffd43b` | **Logo yellow.** Lettering, badges, highlights, icon chips (always with `ink` text). |
| `accent-50`–`accent-900` | Open Color yellow 0–9 | Warning surfaces (`accent-100`), promo badges. |
| `ink` | `#0b1f33` | Body text and headings on light surfaces. |
| `ink-muted` | `#4a5a6a` | Secondary text. |
| `surface` / `surface-muted` | `#ffffff` / `#f1f5f9` | Page and card backgrounds. |

Source of truth: `packages/config/tailwind/tokens.css` (Tailwind) and `packages/config/src/tokens.ts` (TypeScript: `LOGO_BLUE`, `LOGO_YELLOW`, `ACTION_COLOR`, `THEME_COLOR`). `src/tokens.test.ts` keeps them identical and enforces the contrast rules below.

### Contrast rules (WCAG 2.1 AA)

| Pairing | Ratio | Allowed for |
|---|---|---|
| White on `brand-800` | 5.0 : 1 | Any text, buttons |
| `ink` on `accent-400` (yellow) | 11.7 : 1 | Any text (badges, chips) |
| `accent-400` on `brand-800` | 3.5 : 1 | **Large display text only** (≥ 24 px, or ≥ 18.7 px bold), e.g. the hero wordmark |
| White on `brand-600` (logo blue) | 3.6 : 1 | Large text and icons only; never body text or buttons |
| `brand-600` on white | 3.6 : 1 | Icons, focus rings, borders; not small text |
| `accent-400` on white | 1.4 : 1 | **Never** for text or meaningful icons |

That is why primary buttons are `brand-800`, not the logo blue: the logo blue is too light for white button text.

## Typography

- **Display: Lilita One** (the logo typeface; SIL Open Font License, bundled from `@fontsource/lilita-one` and self-hosted with `next/font`). Tailwind class `font-display`. Use it for the wordmark and large headings (≥ 24 px) only, never for body text or long Taglish copy.
- **Body: system UI stack** (`font-sans`). Fast on budget Android phones, no download.

## Voice

Friendly, local and dependable, not corporate (docs/BUSINESS.md §4.1). Taglish is welcome. Tagline: "Delivered to your door, wherever you are." / "Hatid sa pinto mo, nasaan ka man."
