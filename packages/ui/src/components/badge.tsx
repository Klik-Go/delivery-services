import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes, JSX } from "react";
import { cn } from "../lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-control px-2 py-0.5 text-label font-medium",
  {
    variants: {
      tone: {
        /** Turmeric badge — ink text only. Never action fill. */
        turmeric: "bg-accent text-ink",
        action: "bg-action-wash text-action",
        muted: "bg-sheet-alt text-ink-muted",
        seal: "bg-seal-wash text-seal",
        certified: "bg-certified-wash text-certified",
        awaiting: "bg-awaiting-wash text-awaiting",
      },
    },
    defaultVariants: { tone: "muted" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps): JSX.Element {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { badgeVariants };
