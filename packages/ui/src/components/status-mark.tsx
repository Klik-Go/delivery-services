import { cva, type VariantProps } from "class-variance-authority";
import type { JSX, ReactNode } from "react";
import { cn } from "../lib/cn";

const statusMarkVariants = cva(
  "inline-flex items-center gap-1.5 rounded-control border px-2 py-1 text-label font-medium motion-safe:animate-mark-settle",
  {
    variants: {
      tone: {
        action: "border-action/30 bg-action-wash text-action",
        awaiting: "border-awaiting/30 bg-awaiting-wash text-awaiting",
        certified: "border-certified/30 bg-certified-wash text-certified",
        seal: "border-seal/30 bg-seal-wash text-seal",
        muted: "border-rule bg-sheet-alt text-ink-muted",
      },
    },
    defaultVariants: { tone: "muted" },
  },
);

export interface StatusMarkProps extends VariantProps<typeof statusMarkVariants> {
  /** Lucide (or similar) glyph. Always aria-hidden; the word carries meaning. */
  readonly icon: ReactNode;
  /** Written status word — colour never carries state alone. */
  readonly label: string;
  readonly className?: string | undefined;
}

/**
 * Glyph + word status token. Map product states (placed, preparing, delivered, …)
 * onto tone; do not invent colour-only pills.
 */
export function StatusMark({ icon, label, tone, className }: StatusMarkProps): JSX.Element {
  return (
    <span className={cn(statusMarkVariants({ tone }), className)}>
      <span
        aria-hidden
        className="inline-flex size-3.5 shrink-0 items-center justify-center [&>svg]:size-3.5"
      >
        {icon}
      </span>
      <span>{label}</span>
    </span>
  );
}

export { statusMarkVariants };
