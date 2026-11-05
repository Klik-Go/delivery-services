/**
 * Only allows same-site relative paths as post-sign-in destinations, so a crafted `next=` can never
 * send someone to another site (open redirect).
 */
export function safeNextPath(candidate: string | null | undefined, fallback = "/"): string {
  if (
    !candidate ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.startsWith("/\\")
  )
    return fallback;
  try {
    const url = new URL(candidate, "https://klikgo.invalid");
    return url.origin === "https://klikgo.invalid" ? `${url.pathname}${url.search}` : fallback;
  } catch {
    return fallback;
  }
}
