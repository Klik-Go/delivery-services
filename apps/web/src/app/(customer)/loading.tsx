import type { JSX } from "react";

/** Skeleton while the home feed loads (no layout jump when it arrives). */
export default function Loading(): JSX.Element {
  return (
    <div
      aria-busy
      className="mx-auto flex w-full max-w-screen-md flex-col gap-5 px-4 pt-4"
      role="status"
    >
      <span className="sr-only">Loading…</span>
      <div className="bg-surface-muted h-10 w-40 animate-pulse rounded-full motion-reduce:animate-none" />
      <div className="bg-surface-muted min-h-tap w-full animate-pulse rounded-full motion-reduce:animate-none" />
      {[0, 1].map((rail) => (
        <div key={rail} className="flex flex-col gap-2">
          <div className="bg-surface-muted h-6 w-32 animate-pulse rounded motion-reduce:animate-none" />
          <div className="flex gap-3 overflow-hidden">
            {[0, 1, 2].map((card) => (
              <div
                key={card}
                className="rounded-card bg-surface-muted h-48 w-60 shrink-0 animate-pulse motion-reduce:animate-none"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
