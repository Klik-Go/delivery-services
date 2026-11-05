import type { JSX } from "react";

/** Inline error announced to screen readers. */
export function FormError({ message }: { readonly message: string | null }): JSX.Element | null {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="bg-danger-50 text-danger-900 rounded-xl px-3 py-2 text-sm font-medium"
    >
      {message}
    </p>
  );
}
