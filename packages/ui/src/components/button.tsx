import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes, JSX } from "react";
import { cn } from "../lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-control px-4 text-body font-semibold transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none print:hidden",
  {
    variants: {
      variant: {
        // White on action (#1971c2) is 5.0:1; logo blue must never fill a button.
        primary:
          "border border-action bg-action text-white shadow-panel hover:border-action-hover hover:bg-action-hover",
        secondary:
          "border border-rule bg-sheet text-ink hover:border-rule-strong hover:bg-sheet-alt",
        ghost: "border border-transparent bg-transparent text-action hover:bg-action-wash",
        destructive:
          "border border-seal/40 bg-sheet text-seal hover:border-seal hover:bg-seal-wash",
      },
      size: {
        /** 44px — customer, rider, merchant phone. */
        tap: "h-tap min-h-tap",
        /** 36px — desk console from lg up. */
        control: "h-control min-h-control",
        sm: "h-8 min-h-8 px-3 text-record",
        /** @deprecated Prefer `tap`. Kept so existing screens typecheck during the redesign. */
        md: "h-tap min-h-tap",
        /** @deprecated Prefer `tap`. Same 44px target with slightly wider padding. */
        lg: "h-tap min-h-tap px-6",
      },
    },
    defaultVariants: { variant: "primary", size: "tap" },
  },
);

/** Props for {@link Button}. `asChild` renders the child element (e.g. a link) with button styling. */
export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  readonly asChild?: boolean;
}

/** Primary action control. Default height is 44px (PWA); use `size="control"` on the desk. */
export function Button({
  className,
  variant,
  size,
  asChild = false,
  type,
  ...props
}: ButtonProps): JSX.Element {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) return <Slot className={classes} {...props} />;
  return <button type={type ?? "button"} className={classes} {...props} />;
}

export { buttonVariants };
