"use client";

import { RATING_TAGS, type RatingTargetKind } from "@klikgo/types";
import { Star } from "lucide-react";
import { useTranslations } from "next-intl";
import type { JSX } from "react";

/** What one rating form holds (score 0 until a star is picked). */
export interface RatingDraft {
  readonly score: number;
  readonly tags: readonly string[];
  readonly comment: string;
}

export const EMPTY_DRAFT: RatingDraft = { score: 0, tags: [], comment: "" };

/**
 * Stars, quick tags and a comment for one target (store, rider or customer). Stars are a radio
 * group so screen readers and keyboards can pick a score; tags are toggle buttons.
 */
export function RatingForm({
  target,
  label,
  draft,
  onChange,
  disabled = false,
}: {
  readonly target: RatingTargetKind;
  readonly label: string;
  readonly draft: RatingDraft;
  readonly onChange: (draft: RatingDraft) => void;
  readonly disabled?: boolean;
}): JSX.Element {
  const t = useTranslations("Retention.rating");
  const toggle = (tag: string): void => {
    const tags = draft.tags.includes(tag)
      ? draft.tags.filter((x) => x !== tag)
      : [...draft.tags, tag].slice(0, 5);
    onChange({ ...draft, tags });
  };
  return (
    <fieldset className="flex flex-col gap-3" data-rating={target} disabled={disabled}>
      <legend className="text-ink mb-1 text-lg font-bold">{label}</legend>
      <div role="radiogroup" aria-label={t("stars", { label })} className="flex gap-1">
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            key={score}
            type="button"
            role="radio"
            aria-checked={draft.score === score}
            aria-label={t("starLabel", { count: score })}
            onClick={() => onChange({ ...draft, score })}
            className="min-h-tap min-w-tap rounded-control grid place-items-center"
          >
            <Star
              aria-hidden
              className={`size-8 ${score <= draft.score ? "fill-accent-400 text-ink" : "text-ink-muted"}`}
            />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" aria-label={t("tags")}>
        {RATING_TAGS[target].map((tag) => {
          const on = draft.tags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(tag)}
              className={`min-h-tap rounded-control px-3 text-sm font-semibold ${on ? "bg-action text-white" : "bg-sheet-alt text-ink"}`}
            >
              {t(`tag.${tag}`)}
            </button>
          );
        })}
      </div>
      <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
        {t("comment")}
        <textarea
          value={draft.comment}
          onChange={(event) => onChange({ ...draft, comment: event.target.value })}
          maxLength={500}
          rows={2}
          className="border-border rounded-lg border px-3 py-2 font-normal"
        />
      </label>
    </fieldset>
  );
}

/** The body the API takes for one draft (comment left out when empty). */
export function draftBody(draft: RatingDraft): {
  score: number;
  tags: string[];
  comment?: string;
} {
  return {
    score: draft.score,
    tags: [...draft.tags],
    ...(draft.comment.trim() ? { comment: draft.comment.trim() } : {}),
  };
}
