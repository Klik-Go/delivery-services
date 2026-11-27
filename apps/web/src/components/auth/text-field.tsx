import { TextInput } from "@klikgo/ui";
import type { InputHTMLAttributes, JSX } from "react";

/** Props for {@link TextField}. */
export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly label: string;
  readonly error?: string | undefined;
}

/** Labelled input with a 44px tap target, rule-strong border, and an inline error. */
export function TextField({ label, error, id, className, ...props }: TextFieldProps): JSX.Element {
  const inputId = id ?? props.name;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={inputId} className="text-record text-ink font-medium">
        {label}
      </label>
      <TextInput
        id={inputId}
        invalid={Boolean(error)}
        aria-describedby={errorId}
        className={className}
        {...props}
      />
      {error ? (
        <span id={errorId} className="text-label text-seal">
          {error}
        </span>
      ) : null}
    </div>
  );
}
