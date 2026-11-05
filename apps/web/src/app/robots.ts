import type { MetadataRoute } from "next";

/** Keep the pre-launch shell out of search results until the pilot opens. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
