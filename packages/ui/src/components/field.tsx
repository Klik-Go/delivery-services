import type { InputHTMLAttributes, JSX, ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly required?: boolean;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

/** Label + control + hint/error wiring with `aria-describedby`. */
export function Field({
  id,
  label,
  required = false,
  hint,
  error,
  className,
  children,
}: FieldProps): JSX.Element {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-record text-ink font-medium">
        {label}
        {required ? (
          <>
            <span aria-hidden className="text-seal ml-0.5">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        ) : null}
      </label>
      {/* Consumer must forward id + aria-describedby onto the control. */}
      <div data-describedby={describedBy}>{children}</div>
      {hint && !error ? (
        <p id={hintId} className="text-label text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-label text-seal">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const controlClassName =
  "h-tap min-h-tap w-full rounded-control border border-rule-strong bg-sheet px-3 text-body text-ink shadow-sm caret-action selection:bg-action-wash placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:bg-sheet-alt disabled:opacity-60 aria-invalid:border-seal";

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly invalid?: boolean;
  /** Desk density: 36px instead of 44px. */
  readonly density?: "tap" | "control";
}

/** Sheet fill, rule-strong border, 6px corners. Height follows the 44/36 rule. */
export function TextInput({
  className,
  invalid,
  density = "tap",
  ...props
}: TextInputProps): JSX.Element {
  return (
    <input
      className={cn(
        controlClassName,
        density === "control" && "h-control min-h-control",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly invalid?: boolean;
}

export function TextArea({ className, invalid, ...props }: TextAreaProps): JSX.Element {
  return (
    <textarea
      className={cn(controlClassName, "h-auto min-h-24 py-2", className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}
