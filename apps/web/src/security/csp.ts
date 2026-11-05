/** Inputs for {@link buildContentSecurityPolicy}. */
export interface CspOptions {
  /** Per-request random nonce; Next.js adds it to its own <script> tags. */
  readonly nonce: string;
  /** Development needs eval (React Refresh) and HMR websockets. */
  readonly isDev: boolean;
  /** Supabase project URL, allowed for Realtime (wss) and Storage images. */
  readonly supabaseUrl?: string | undefined;
  /** Origin of the map tile provider (src/lib/map-tiles.ts); defaults to OpenStreetMap. */
  readonly tileOrigin?: string | undefined;
}

function supabaseOrigins(
  supabaseUrl: string | undefined,
): { https: string; wss: string } | undefined {
  if (!supabaseUrl) return undefined;
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return { https: url.origin, wss: url.origin.replace(/^http/, "ws") };
  } catch {
    return undefined;
  }
}

/**
 * Builds a strict, nonce-based CSP. `'strict-dynamic'` lets nonce-trusted Next.js chunks load
 * their dependencies while blocking injected inline scripts (the main XSS vector).
 */
export function buildContentSecurityPolicy({
  nonce,
  isDev,
  supabaseUrl,
  tileOrigin = "https://tile.openstreetmap.org",
}: CspOptions): string {
  const supabase = supabaseOrigins(supabaseUrl);
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(isDev ? ["'unsafe-eval'"] : []),
  ];
  const connectSrc = [
    "'self'",
    ...(supabase ? [supabase.https, supabase.wss] : []),
    ...(isDev ? ["ws:"] : []),
  ];
  // Map tiles for the pin maps (partner form, address setup; attribution shown on the map).
  const imgSrc = ["'self'", "blob:", "data:", tileOrigin, ...(supabase ? [supabase.https] : [])];

  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", scriptSrc],
    // Next.js and Tailwind inject a few inline style attributes; styles cannot execute code.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", imgSrc],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", connectSrc],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];

  const policy = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  if (!isDev) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

/** Returns a 128-bit random nonce, base64-encoded. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}
