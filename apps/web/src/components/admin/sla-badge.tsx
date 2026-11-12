import type { SlaState } from "@klikgo/core";
import { useTranslations } from "next-intl";
import type { JSX } from "react";

const STYLES: Readonly<Record<SlaState, string>> = {
  on_time: "bg-brand-50 text-brand-800",
  at_risk: "bg-accent-400 text-ink",
  late: "bg-danger-900 text-white",
};

/** The order's timer as a coloured label (words too, never colour alone). */
export function SlaBadge({ state }: { readonly state: SlaState }): JSX.Element {
  const t = useTranslations("Ops.board.sla");
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-bold ${STYLES[state]}`} data-sla={state}>
      {t(state)}
    </span>
  );
}
