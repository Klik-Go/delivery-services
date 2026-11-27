import type { SlaState } from "@klikgo/core";
import { StatusMark } from "@klikgo/ui";
import { AlertTriangle, CheckCircle2, Clock3 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { JSX } from "react";

const TONE: Readonly<Record<SlaState, "certified" | "awaiting" | "seal">> = {
  on_time: "certified",
  at_risk: "awaiting",
  late: "seal",
};

const ICON: Readonly<Record<SlaState, typeof CheckCircle2>> = {
  on_time: CheckCircle2,
  at_risk: Clock3,
  late: AlertTriangle,
};

/** SLA as glyph + word (never colour alone). */
export function SlaBadge({ state }: { readonly state: SlaState }): JSX.Element {
  const t = useTranslations("Ops.board.sla");
  const Icon = ICON[state];
  return (
    <span data-sla={state}>
      <StatusMark tone={TONE[state]} icon={<Icon />} label={t(state)} />
    </span>
  );
}
