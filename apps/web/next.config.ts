import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { STATIC_SECURITY_HEADERS } from "./src/security/security-headers";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

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
  ],
  serverExternalPackages: ["pino"],
  // ESLint runs as its own CI step (`pnpm lint`) with the shared flat config.
  eslint: { ignoreDuringBuilds: true },
  headers() {
    return Promise.resolve([{ source: "/:path*", headers: [...STATIC_SECURITY_HEADERS] }]);
  },
};

export default withNextIntl(nextConfig);
