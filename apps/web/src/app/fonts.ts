import localFont from "next/font/local";

/**
 * Inter for every UI word. Self-hosted via @fontsource so CSP `font-src 'self'` holds.
 * Exposed as `--font-inter`, which the `font-sans` token reads.
 */
export const inter = localFont({
  src: [
    {
      path: "../../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/inter/files/inter-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
  ],
  display: "swap",
  variable: "--font-inter",
  adjustFontFallback: "Arial",
});

/**
 * JetBrains Mono with tabular figures for money, refs, dates, times, and counts.
 * Exposed as `--font-jetbrains-mono`, which the `font-mono` token reads.
 */
export const jetbrainsMono = localFont({
  src: [
    {
      path: "../../node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
  ],
  display: "swap",
  variable: "--font-jetbrains-mono",
  adjustFontFallback: false,
});

/**
 * Lilita One, the KGo logo typeface (SIL Open Font License, via @fontsource). Self-hosted by
 * next/font so it loads from our origin (CSP `font-src 'self'`) with no request to Google.
 * Exposed as `--font-lilita-one`, which the `font-display` token reads. Use only on BrandLogo
 * wordmark — never for page titles, body, or legal headings.
 */
export const lilitaOne = localFont({
  src: "../../node_modules/@fontsource/lilita-one/files/lilita-one-latin-400-normal.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  variable: "--font-lilita-one",
});
