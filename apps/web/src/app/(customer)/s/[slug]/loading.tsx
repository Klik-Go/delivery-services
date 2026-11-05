import type { JSX } from "react";

/** Skeleton while a store page loads. */
export default function Loading(): JSX.Element {
  return (
    <div
      aria-busy
      role="status"
      className="mx-auto flex w-full max-w-screen-md flex-col gap-4 px-4 pt-4"
    >
      <span className="sr-only">Loading…</span>
      <div className="rounded-card bg-surface-muted aspect-[16/7] w-full animate-pulse motion-reduce:animate-none" />
      <div className="bg-surface-muted h-8 w-2/3 animate-pulse rounded motion-reduce:animate-none" />
      <div className="bg-surface-muted min-h-tap w-full animate-pulse rounded-full motion-reduce:animate-none" />
      {[0, 1, 2, 3].map((row) => (
        <div
          key={row}
          className="rounded-card bg-surface-muted h-20 w-full animate-pulse motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}
