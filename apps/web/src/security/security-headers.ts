/** A response header as Next.js `headers()` config expects it. */
export interface HeaderEntry {
  readonly key: string;
  readonly value: string;
}

/**
 * Headers that are the same for every response, applied in next.config.ts.
 * The CSP is per-request (it carries a nonce), so it is set in middleware instead.
 */
export const STATIC_SECURITY_HEADERS: readonly HeaderEntry[] = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // Location for address pin drop and rider GPS; camera for menu photo import and delivery proof.
    value:
      "geolocation=(self), camera=(self), microphone=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];
