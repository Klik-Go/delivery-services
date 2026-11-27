import { Skeleton } from "@klikgo/ui";
import type { JSX } from "react";

/** Skeleton while the home feed loads (no layout jump when it arrives). */
export default function Loading(): JSX.Element {
  return (
    <div
      aria-busy
      className="mx-auto flex w-full max-w-screen-lg flex-col gap-5 px-4 pt-4"
      role="status"
    >
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-10 w-48" />
      <Skeleton className="min-h-tap w-full" />
      {[0, 1].map((rail) => (
        <div key={rail} className="flex flex-col gap-2">
          <Skeleton className="h-6 w-32" />
          <div className="flex gap-3 overflow-hidden">
            {[0, 1, 2].map((card) => (
              <Skeleton key={card} className="h-48 w-60 shrink-0" rounded="panel" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
