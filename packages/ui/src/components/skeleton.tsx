import type { HTMLAttributes, JSX } from "react";
import { cn } from "../lib/cn";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  readonly rounded?: "control" | "panel" | "full";
}

/** Pulse placeholder. Honors prefers-reduced-motion via globals. */
export function Skeleton({ className, rounded = "control", ...props }: SkeletonProps): JSX.Element {
  return (
    <div
      aria-hidden
      className={cn(
        "bg-sheet-alt animate-pulse motion-reduce:animate-none",
        rounded === "control" && "rounded-control",
        rounded === "panel" && "rounded-panel",
        rounded === "full" && "rounded-full",
        className,
      )}
      {...props}
    />
  );
}
