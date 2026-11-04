import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes, JSX } from "react";
import { cn } from "../lib/cn";

const buttonVariants = cva(
  "inline-flex min-h-tap items-center justify-center gap-2 rounded-full px-5 text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none",
  {
    variants: {
      variant: {
        primary: "bg-brand-700 text-white hover:bg-brand-800",
        secondary: "bg-surface-muted text-ink hover:bg-brand-100",
        ghost: "bg-transparent text-brand-700 hover:bg-brand-50",
      },
      size: {
        md: "h-tap",
        lg: "h-14 px-6 text-lg",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

/** Props for {@link Button}. `asChild` renders the child element (e.g. a link) with button styling. */
export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  readonly asChild?: boolean;
}

/** Primary action control with a 44px minimum tap target. */
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
