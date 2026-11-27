import type { JSX, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string | undefined;
  /** One primary action (Button or Link styled as Button). */
  readonly action?: ReactNode;
  readonly className?: string | undefined;
}

/** Short sentence + one primary action. Replaces muted text + underline links. */
export function EmptyState({
  title,
  description,
  action,
  className,
}: EmptyStateProps): JSX.Element {
  return (
    <div
      className={cn(
        "rounded-panel border-rule bg-sheet shadow-panel flex flex-col items-start gap-3 border px-4 py-8",
        className,
      )}
    >
      <h2 className="text-title text-ink">{title}</h2>
      {description ? <p className="text-body text-ink-muted max-w-prose">{description}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
