import localFont from "next/font/local";

/**
 * Lilita One, the KGo logo typeface (SIL Open Font License, via @fontsource). Self-hosted by
 * next/font so it loads from our origin (CSP `font-src 'self'`) with no request to Google.
 * Exposed as `--font-lilita-one`, which the `font-display` token reads (packages/config).
 */
export const lilitaOne = localFont({
  src: "../../node_modules/@fontsource/lilita-one/files/lilita-one-latin-400-normal.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  variable: "--font-lilita-one",
});
