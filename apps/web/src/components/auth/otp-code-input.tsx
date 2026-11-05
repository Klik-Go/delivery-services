"use client";

import { useTranslations } from "next-intl";
import { useRef, type ClipboardEvent, type JSX, type KeyboardEvent } from "react";

const LENGTH = 6;

/** Props for {@link OtpCodeInput}. */
export interface OtpCodeInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
}

/**
 * Six one-digit boxes with auto-advance, backspace-to-previous and paste/autofill of the whole
 * code (SMS one-time-code autofill lands in the first box).
 */
export function OtpCodeInput({
  value,
  onChange,
  disabled = false,
  invalid = false,
}: OtpCodeInputProps): JSX.Element {
  const t = useTranslations("Auth");
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: LENGTH }, (_, i) => value[i] ?? "");

  function setFrom(index: number, typed: string): void {
    const clean = typed.replace(/\D/g, "");
    if (!clean) return;
    const next = (value.slice(0, index) + clean).slice(0, LENGTH);
    onChange(next);
    boxes.current[Math.min(next.length, LENGTH - 1)]?.focus();
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      onChange(value.slice(0, index - 1));
      boxes.current[index - 1]?.focus();
    } else if (event.key === "Backspace") {
      onChange(value.slice(0, index));
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>): void {
    event.preventDefault();
    setFrom(0, event.clipboardData.getData("text"));
  }

  return (
    <div className="grid grid-cols-6 gap-2" role="group">
      {digits.map((digit, index) => (
        <input
          // Positions are stable; the index is the identity of each box.
          key={index}
          ref={(element) => {
            boxes.current[index] = element;
          }}
          aria-label={t("digit", { n: index + 1 })}
          aria-invalid={invalid || undefined}
          autoComplete={index === 0 ? "one-time-code" : "off"}
          inputMode="numeric"
          pattern="[0-9]*"
          disabled={disabled}
          value={digit}
          onChange={(event) => setFrom(index, event.target.value)}
          onKeyDown={(event) => onKeyDown(index, event)}
          onPaste={onPaste}
          className="border-ink-muted/40 focus:border-brand-800 focus:outline-brand-600 text-ink aria-invalid:border-danger-900 h-14 w-full min-w-0 rounded-xl border-2 text-center text-2xl font-semibold"
        />
      ))}
    </div>
  );
}
