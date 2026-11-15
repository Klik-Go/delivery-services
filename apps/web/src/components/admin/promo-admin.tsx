"use client";

import { formatPeso, type PromoSummary } from "@klikgo/core";
import type { PromoType } from "@klikgo/types";
import { Button } from "@klikgo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { fetchData, postJson } from "@/lib/post-json";
import type { Wire } from "./wire";

const TYPES: readonly PromoType[] = ["fixed_off", "percent_off", "free_delivery"];

/** Pesos typed by a person → integer centavos (empty → undefined). */
const centavos = (pesos: string): number | undefined =>
  pesos.trim() === "" ? undefined : Math.round(Number(pesos) * 100);
const whole = (value: string): number | undefined =>
  value.trim() === "" ? undefined : Math.round(Number(value));

interface Draft {
  code: string;
  type: PromoType;
  amount: string;
  percent: string;
  cap: string;
  min: string;
  starts: string;
  ends: string;
  maxUses: string;
  perCustomer: string;
  budget: string;
  firstOrders: string;
  description: string;
}

const EMPTY: Draft = {
  code: "",
  type: "fixed_off",
  amount: "",
  percent: "",
  cap: "",
  min: "",
  starts: "",
  ends: "",
  maxUses: "",
  perCustomer: "1",
  budget: "",
  firstOrders: "",
  description: "",
};

/** Promo campaigns: create codes with caps, a peso budget and eligibility; switch them off. */
export function PromoAdmin(): JSX.Element {
  const t = useTranslations("Retention.promos");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ["admin-promos"],
    queryFn: () => fetchData<Wire<PromoSummary>[]>("/api/admin/promos", t("failed")),
  });
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>): void => setDraft((d) => ({ ...d, ...patch }));
  const date = new Intl.DateTimeFormat(locale === "fil" ? "fil-PH" : "en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
  });

  const create = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const body = {
      code: draft.code,
      type: draft.type,
      ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
      ...(draft.type === "fixed_off" ? { discountCentavos: centavos(draft.amount) } : {}),
      ...(draft.type === "percent_off" ? { discountBps: (whole(draft.percent) ?? 0) * 100 } : {}),
      ...(draft.type !== "fixed_off" && draft.cap
        ? { maxDiscountCentavos: centavos(draft.cap) }
        : {}),
      minSubtotalCentavos: centavos(draft.min) ?? 0,
      // Whole days in Manila time.
      startsAt: `${draft.starts}T00:00:00+08:00`,
      endsAt: `${draft.ends}T23:59:59+08:00`,
      ...(draft.maxUses ? { maxRedemptions: whole(draft.maxUses) } : {}),
      perUserLimit: whole(draft.perCustomer) ?? 1,
      ...(draft.budget ? { budgetCentavos: centavos(draft.budget) } : {}),
      ...(draft.firstOrders ? { firstOrders: whole(draft.firstOrders) } : {}),
    };
    const result = await postJson<{ id: string }>("/api/admin/promos", body, t("failed"));
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDraft(EMPTY);
    void queryClient.invalidateQueries({ queryKey: ["admin-promos"] });
  };

  const toggle = async (promo: Wire<PromoSummary>): Promise<void> => {
    const result = await postJson<unknown>(
      `/api/admin/promos/${promo.id}`,
      { isActive: !promo.isActive },
      t("failed"),
    );
    if (!result.ok) setError(result.message);
    void queryClient.invalidateQueries({ queryKey: ["admin-promos"] });
  };

  const field = (
    key: keyof Draft,
    label: string,
    props: Record<string, string> = {},
  ): JSX.Element => (
    <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
      {label}
      <input
        value={draft[key]}
        onChange={(event) => set({ [key]: event.target.value })}
        className="border-border min-h-tap rounded-lg border px-3 font-normal"
        {...props}
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-6">
      <section
        className="border-border flex flex-col gap-3 rounded-xl border p-4"
        aria-labelledby="new-promo"
      >
        <h2 id="new-promo" className="text-ink text-lg font-bold">
          {t("newTitle")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("code", t("code"), { maxLength: "20", autoCapitalize: "characters" })}
          <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
            {t("type")}
            <select
              value={draft.type}
              onChange={(event) => set({ type: event.target.value as PromoType })}
              className="border-border min-h-tap rounded-lg border px-3 font-normal"
            >
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`types.${type}`)}
                </option>
              ))}
            </select>
          </label>
          {draft.type === "fixed_off"
            ? field("amount", t("amount"), { inputMode: "decimal" })
            : null}
          {draft.type === "percent_off"
            ? field("percent", t("percent"), { inputMode: "numeric" })
            : null}
          {draft.type !== "fixed_off" ? field("cap", t("cap"), { inputMode: "decimal" }) : null}
          {field("min", t("min"), { inputMode: "decimal" })}
          {field("starts", t("starts"), { type: "date" })}
          {field("ends", t("ends"), { type: "date" })}
          {field("budget", t("budget"), { inputMode: "decimal" })}
          {field("maxUses", t("maxUses"), { inputMode: "numeric" })}
          {field("perCustomer", t("perCustomer"), { inputMode: "numeric" })}
          {field("firstOrders", t("firstOrders"), { inputMode: "numeric" })}
          {field("description", t("description"), { maxLength: "120" })}
        </div>
        <p className="text-ink-muted text-sm">{t("abuseNote")}</p>
        {error ? <FormError message={error} /> : null}
        <Button
          disabled={busy || draft.code.trim().length < 4 || !draft.starts || !draft.ends}
          onClick={() => void create()}
        >
          {t("create")}
        </Button>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="promo-list">
        <h2 id="promo-list" className="text-ink text-lg font-bold">
          {t("listTitle")}
        </h2>
        {list.isPending ? <p className="text-ink-muted">{t("loading")}</p> : null}
        {list.isError ? <FormError message={list.error.message} /> : null}
        {list.data?.length === 0 ? <p className="text-ink-muted">{t("empty")}</p> : null}
        <ul className="flex flex-col gap-2" data-testid="promo-list">
          {list.data?.map((promo) => (
            <li
              key={promo.id}
              className="border-border flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center"
              data-promo={promo.code}
            >
              <div className="flex-1">
                <p className="text-ink font-bold">
                  {promo.code} · {t(`types.${promo.type}`)}
                  {promo.isActive ? "" : ` · ${t("off")}`}
                </p>
                <p className="text-ink-muted text-sm">
                  {date.format(new Date(promo.startsAt))}–{date.format(new Date(promo.endsAt))} ·{" "}
                  {t("used", {
                    count: promo.redemptions,
                    given: formatPeso(promo.discountGivenCentavos),
                  })}
                  {promo.budgetCentavos
                    ? ` · ${t("ofBudget", { budget: formatPeso(promo.budgetCentavos) })}`
                    : ""}
                </p>
              </div>
              <Button variant="secondary" onClick={() => void toggle(promo)}>
                {promo.isActive ? t("switchOff") : t("switchOn")}
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
