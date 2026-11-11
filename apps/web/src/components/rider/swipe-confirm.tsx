"use client";

import { ChevronsRight } from "lucide-react";
import { useState, type JSX } from "react";

/**
 * Slide-to-confirm for steps that must not happen by a stray tap in a pocket (BUILD_PLAN Phase 7).
 * It is a range input, so keyboards and screen readers can use it too: confirming needs the end.
 */
export function SwipeConfirm({
  label,
  onConfirm,
  disabled = false,
}: {
  readonly label: string;
  readonly onConfirm: () => void;
  readonly disabled?: boolean;
}): JSX.Element {
  const [value, setValue] = useState(0);
  const release = (): void => {
    if (value >= 95 && !disabled) onConfirm();
    setValue(0);
  };
  return (
    <div className="bg-brand-800 relative h-14 w-full overflow-hidden rounded-full">
      <span className="pointer-events-none absolute inset-0 grid place-items-center font-semibold text-white">
        {label}
      </span>
      <span
        className="bg-accent-400 text-ink pointer-events-none absolute top-1 left-1 grid size-12 place-items-center rounded-full"
        aria-hidden
      >
        <ChevronsRight className="size-6" />
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={label}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        onChange={(event) => {
          const next = Number(event.target.value);
          setValue(next);
          // Keyboards and tests set the value in one step; a finger drags there.
          if (next >= 100 && !disabled) {
            onConfirm();
            setValue(0);
          }
        }}
        onPointerUp={release}
        onTouchEnd={release}
        onKeyUp={(event) => {
          if (event.key === "Enter" && !disabled) onConfirm();
        }}
      />
    </div>
  );
}
