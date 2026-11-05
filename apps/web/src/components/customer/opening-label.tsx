import type { OpeningStatus } from "@klikgo/core";
import { useTranslations } from "next-intl";
import type { JSX } from "react";

/** "Closed · Opens 17:00" style label for a store that is not open now. */
export function OpeningLabel({ opening }: { readonly opening: OpeningStatus }): JSX.Element | null {
  const t = useTranslations("Customer");
  if (opening.open) return null;
  const at = opening.opensAt;
  const when = !at
    ? null
    : at.day === "today"
      ? t("opensToday", { time: at.time })
      : at.day === "tomorrow"
        ? t("opensTomorrow", { time: at.time })
        : t("opensDay", { day: t(`days.${at.day}`), time: at.time });
  return (
    <span className="bg-surface-muted text-ink rounded-full px-2 py-0.5 text-xs font-semibold">
      {t("closed")}
      {when ? ` · ${when}` : ""}
    </span>
  );
}
