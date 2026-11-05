import { permanentRedirect } from "next/navigation";

/** The Phase 3 public store link; the customer store page now lives at /s/:slug. */
export default async function LegacyStorePage({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
}): Promise<never> {
  permanentRedirect(`/s/${encodeURIComponent((await params).slug)}`);
}
