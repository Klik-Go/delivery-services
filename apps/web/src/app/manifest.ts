import { THEME_COLOR } from "@klikgo/config/tokens";
import type { MetadataRoute } from "next";

/** Web app manifest: installable customer app (docs/BUILD_PLAN.md Phase 4 "PWA"). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Klik Go",
    short_name: "Klik Go",
    description: "Food and essentials from your barangay, delivered.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: THEME_COLOR,
    categories: ["food", "shopping"],
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
