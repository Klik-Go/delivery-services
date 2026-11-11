"use client";

import { formatPeso, type StaffGrant, type ZoneView } from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { fetchData, requestJson } from "@/lib/post-json";
import type { Wire } from "./wire";

const AreaEditor = dynamic(() => import("./area-editor").then((m) => m.AreaEditor), { ssr: false });

const pesos = (centavos: number): string => (centavos / 100).toFixed(2);
const centavos = (value: string): number => Math.round(Number(value) * 100);

/** Zones (docs/BUSINESS.md §5.5): fees, radius, status, coordinator, fee rules and the outline. */
export function ZoneEditor({ isAdmin }: { readonly isAdmin: boolean }): JSX.Element {
  const t = useTranslations("Ops.zones");
  const tOps = useTranslations("Ops");
  const zones = useQuery({
    queryKey: ["ops-zones"],
    queryFn: () => fetchData<Wire<ZoneView>[]>("/api/admin/zones", tOps("failed")),
  });
  const staff = useQuery({
    queryKey: ["ops-staff"],
    queryFn: () => fetchData<Wire<StaffGrant>[]>("/api/admin/staff", tOps("failed")),
    enabled: isAdmin,
  });
  const [selected, setSelected] = useState<string | null>(null);
  if (zones.isPending) return <p className="text-ink-muted">{tOps("loading")}</p>;
  if (zones.isError) return <FormError message={zones.error.message} />;
  const zone = zones.data.find((z) => z.id === selected) ?? zones.data[0];
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label={t("title")} className="flex flex-wrap gap-2">
        {zones.data.map((z) => (
          <button
            key={z.id}
            type="button"
            role="tab"
            aria-selected={z.id === zone?.id}
            onClick={() => setSelected(z.id)}
            className={`min-h-tap rounded-full px-4 text-sm font-semibold ${z.id === zone?.id ? "bg-brand-800 text-white" : "bg-surface-muted text-ink"}`}
          >
            {z.name}
          </button>
        ))}
      </div>
      {zone ? (
        <ZoneForm
          key={zone.id}
          zone={zone}
          isAdmin={isAdmin}
          coordinators={(staff.data ?? []).filter(
            (g) => g.role === "coordinator" && g.zoneId === zone.id,
          )}
        />
      ) : null}
    </div>
  );
}

function ZoneForm({
  zone,
  isAdmin,
  coordinators,
}: {
  readonly zone: Wire<ZoneView>;
  readonly isAdmin: boolean;
  readonly coordinators: readonly Wire<StaffGrant>[];
}): JSX.Element {
  const t = useTranslations("Ops.zones");
  const tOps = useTranslations("Ops");
  const queryClient = useQueryClient();
  const [baseFee, setBaseFee] = useState(pesos(zone.baseFeeCentavos));
  const [perKm, setPerKm] = useState(pesos(zone.perKmCentavos));
  const [radius, setRadius] = useState(String(zone.maxRadiusKm));
  const [active, setActive] = useState(zone.isActive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const send = async (
    method: "PATCH" | "PUT" | "POST",
    path: string,
    body: unknown,
  ): Promise<void> => {
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await requestJson<unknown>(method, path, body, tOps("failed"));
    setBusy(false);
    if (result.ok) setSaved(true);
    else setError(result.message);
    void queryClient.invalidateQueries({ queryKey: ["ops-zones"] });
  };

  const field = "border-border min-h-tap rounded-lg border px-3 font-normal";
  return (
    <div className="flex flex-col gap-5" data-zone={zone.slug}>
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send("PATCH", `/api/admin/zones/${zone.id}`, {
            baseFeeCentavos: centavos(baseFee),
            perKmCentavos: centavos(perKm),
            maxRadiusKm: Number(radius),
            isActive: active,
          });
        }}
      >
        <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
          {t("baseFee")}
          <input
            className={field}
            inputMode="decimal"
            value={baseFee}
            disabled={!isAdmin}
            onChange={(e) => setBaseFee(e.target.value)}
          />
        </label>
        <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
          {t("perKm")}
          <input
            className={field}
            inputMode="decimal"
            value={perKm}
            disabled={!isAdmin}
            onChange={(e) => setPerKm(e.target.value)}
          />
        </label>
        <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
          {t("radius")}
          <input
            className={field}
            inputMode="decimal"
            value={radius}
            disabled={!isAdmin}
            onChange={(e) => setRadius(e.target.value)}
          />
        </label>
        <label className="text-ink flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={active}
            disabled={!isAdmin}
            onChange={(e) => setActive(e.target.checked)}
            className="size-5"
          />
          {t("active")}
        </label>
        {isAdmin ? (
          <Button type="submit" disabled={busy} className="sm:col-span-2">
            {tOps("save")}
          </Button>
        ) : null}
      </form>

      <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
        {t("coordinator")}
        <select
          className={`${field} bg-surface`}
          disabled={!isAdmin || busy}
          value={zone.coordinatorId ?? ""}
          onChange={(e) =>
            void send("PUT", `/api/admin/zones/${zone.id}/coordinator`, {
              userId: e.target.value || null,
            })
          }
        >
          <option value="">{t("noCoordinator")}</option>
          {zone.coordinatorId && !coordinators.some((c) => c.userId === zone.coordinatorId) ? (
            <option value={zone.coordinatorId}>{zone.coordinatorName ?? zone.coordinatorId}</option>
          ) : null}
          {coordinators.map((c) => (
            <option key={c.id} value={c.userId}>
              {c.name ?? c.email ?? c.userId}
            </option>
          ))}
        </select>
      </label>

      <section aria-labelledby={`rules-${zone.id}`} className="flex flex-col gap-2">
        <h3 id={`rules-${zone.id}`} className="text-ink text-lg font-bold">
          {t("feeRules")}
        </h3>
        <ul className="flex flex-col gap-2">
          {zone.feeRules.map((rule) => (
            <FeeRuleRow
              key={rule.id}
              rule={rule}
              disabled={!isAdmin || busy}
              onSave={(fee) =>
                void send("PATCH", `/api/admin/fee-rules/${rule.id}`, { feeCentavos: fee })
              }
            />
          ))}
        </ul>
      </section>

      <section aria-labelledby={`area-${zone.id}`} className="flex flex-col gap-2">
        <h3 id={`area-${zone.id}`} className="text-ink text-lg font-bold">
          {t("area")}
        </h3>
        <AreaEditor
          initial={zone.ring}
          disabled={!isAdmin}
          busy={busy}
          onSave={(ring) => void send("PUT", `/api/admin/zones/${zone.id}/area`, { ring })}
        />
      </section>
      {error ? <FormError message={error} /> : null}
      {saved ? (
        <p role="status" className="text-brand-800 font-semibold">
          {tOps("saved")}
        </p>
      ) : null}
    </div>
  );
}

function FeeRuleRow({
  rule,
  disabled,
  onSave,
}: {
  readonly rule: Wire<ZoneView>["feeRules"][number];
  readonly disabled: boolean;
  readonly onSave: (feeCentavos: number) => void;
}): JSX.Element {
  const t = useTranslations("Ops.zones");
  const tOps = useTranslations("Ops");
  const [fee, setFee] = useState(pesos(rule.feeCentavos));
  const range =
    rule.minDistanceM !== null && rule.maxDistanceM !== null
      ? t("band", { from: rule.minDistanceM / 1000, to: rule.maxDistanceM / 1000 })
      : rule.minDistanceM !== null
        ? t("bandOpen", { from: rule.minDistanceM / 1000 })
        : rule.minSubtotalCentavos !== null
          ? t("minSubtotal", { amount: pesos(rule.minSubtotalCentavos) })
          : "";
  return (
    <li
      className="bg-surface-muted flex flex-wrap items-end gap-2 rounded-lg p-2"
      data-rule={rule.name}
    >
      <div className="flex-1">
        <p className="text-ink text-sm font-semibold">{rule.name}</p>
        <p className="text-ink-muted text-xs">
          {range} {rule.isActive ? "" : "· off"} · {formatPeso(rule.feeCentavos)}
        </p>
      </div>
      <label className="text-ink flex flex-col gap-1 text-xs font-semibold">
        {t("fee")}
        <input
          inputMode="decimal"
          value={fee}
          disabled={disabled}
          onChange={(e) => setFee(e.target.value)}
          className="border-border min-h-tap w-24 rounded-lg border px-2 font-normal"
        />
      </label>
      {!disabled ? (
        <Button type="button" variant="secondary" onClick={() => onSave(centavos(fee))}>
          {tOps("save")}
        </Button>
      ) : null}
    </li>
  );
}
