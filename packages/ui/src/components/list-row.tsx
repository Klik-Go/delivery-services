import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes, JSX, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface ListRowProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  readonly asChild?: boolean;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
}

/** Operable list row with a 44px minimum hit area. */
export function ListRow({
  asChild = false,
  leading,
  trailing,
  title,
  description,
  className,
  type,
  ...props
}: ListRowProps): JSX.Element {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      type={asChild ? undefined : (type ?? "button")}
      className={cn(
        "border-rule hover:bg-sheet-alt min-h-tap flex w-full items-center gap-3 border-b px-1 py-2 text-left transition-colors duration-150 last:border-b-0",
        className,
      )}
      {...props}
    >
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body text-ink font-medium">{title}</span>
        {description ? (
          <span className="text-record text-ink-muted truncate">{description}</span>
        ) : null}
      </span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </Comp>
  );
}
