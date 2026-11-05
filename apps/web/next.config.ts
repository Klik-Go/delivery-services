import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { STATIC_SECURITY_HEADERS } from "./src/security/security-headers";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** Menu and cover photos come from Supabase Storage's public bucket (served optimised as WebP). */
interface StoragePattern {
  protocol: "http" | "https";
  hostname: string;
  port?: string;
  pathname: string;
}

function storagePatterns(): StoragePattern[] {
  const patterns: StoragePattern[] = [
    { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
  ];
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (configured) {
    const url = new URL(configured);
    patterns.push({
      protocol: url.protocol === "http:" ? "http" : "https",
      hostname: url.hostname,
      ...(url.port ? { port: url.port } : {}),
      pathname: "/storage/v1/object/public/**",
    });
  }
  return patterns;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: [
    "@klikgo/core",
    "@klikgo/adapters",
    "@klikgo/types",
    "@klikgo/ui",
    "@klikgo/config",
    "@klikgo/db",
  ],
  // forbidden() renders app/forbidden.tsx with HTTP 403 for wrong-role access (experimental in Next 16).
  experimental: { authInterrupts: true },
  // Render <head> metadata before the body for every client, not only bots. With streamed
  // metadata, pages with async generateMetadata (store pages) put <link rel="manifest"> in <body>,
  // where Chrome ignores it, so the store page was not installable (Phase 4 acceptance).
  htmlLimitedBots: /.*/,
  serverExternalPackages: ["pino"],
  images: { formats: ["image/webp"], remotePatterns: storagePatterns() },
  headers() {
    return Promise.resolve([{ source: "/:path*", headers: [...STATIC_SECURITY_HEADERS] }]);
  },
};

export default withNextIntl(nextConfig);
