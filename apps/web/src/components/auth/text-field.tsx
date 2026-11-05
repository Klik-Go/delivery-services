import type { InputHTMLAttributes, JSX } from "react";

/** Props for {@link TextField}. */
export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly label: string;
  readonly error?: string | undefined;
}

/** Labelled input with a 44px tap target and an inline error. */
export function TextField({ label, error, id, ...props }: TextFieldProps): JSX.Element {
  const inputId = id ?? props.name;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={inputId} className="text-ink text-sm font-semibold">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className="border-ink-muted/40 focus:border-brand-800 focus:outline-brand-600 text-ink min-h-tap w-full min-w-0 rounded-xl border-2 px-3 text-base"
        {...props}
      />
      {error ? (
        <span id={errorId} className="text-danger-900 text-sm">
          {error}
        </span>
      ) : null}
    </div>
  );
}
