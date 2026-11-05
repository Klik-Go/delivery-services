"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type JSX, type ReactNode } from "react";

/**
 * A bottom sheet on the native <dialog> (focus trap, Escape and backdrop close for free; no extra
 * library). Slides up on phones, centres on wider screens.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  closeLabel,
  children,
  footer,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly closeLabel: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-label={title}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      className="rounded-t-card backdrop:bg-ink/50 sm:rounded-card m-0 mt-auto max-h-[90dvh] w-full max-w-none bg-white p-0 sm:m-auto sm:max-w-lg"
    >
      <div className="flex max-h-[90dvh] flex-col">
        <header className="border-brand-100 flex items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="text-ink text-lg font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="min-h-tap min-w-tap text-ink-muted grid place-items-center rounded-full"
          >
            <X aria-hidden className="size-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer ? <footer className="border-brand-100 border-t px-4 py-3">{footer}</footer> : null}
      </div>
    </dialog>
  );
}
