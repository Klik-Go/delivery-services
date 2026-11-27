import type { JSX } from "react";
import { cn } from "../lib/cn";

export interface OrderProgressStep {
  readonly id: string;
  readonly label: string;
  readonly state: "done" | "current" | "upcoming";
}

export interface OrderProgressProps {
  readonly steps: readonly OrderProgressStep[];
  readonly className?: string | undefined;
}

/**
 * Simple order-progress timeline. Current step uses action; upcoming uses ink-faint.
 * 12px ring on the current spine node.
 */
export function OrderProgress({ steps, className }: OrderProgressProps): JSX.Element {
  return (
    <ol className={cn("flex flex-col gap-0", className)}>
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        return (
          <li key={step.id} className="flex gap-3">
            <div className="flex w-3 flex-col items-center">
              <span
                className={cn(
                  "mt-1 size-3 shrink-0 rounded-full border-2",
                  step.state === "done" && "border-certified bg-certified",
                  step.state === "current" &&
                    "border-action bg-action ring-action/30 size-3 ring-[3px]",
                  step.state === "upcoming" && "border-rule bg-sheet",
                )}
              />
              {!isLast ? (
                <span
                  className={cn(
                    "mt-1 w-px grow",
                    step.state === "done" ? "bg-certified" : "bg-rule",
                  )}
                />
              ) : null}
            </div>
            <p
              className={cn(
                "text-body pb-4",
                step.state === "current" && "text-ink font-semibold",
                step.state === "done" && "text-ink-muted",
                step.state === "upcoming" && "text-ink-faint",
              )}
            >
              {step.label}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
