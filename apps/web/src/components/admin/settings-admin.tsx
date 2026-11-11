"use client";

import type { FeatureFlagView } from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { fetchData, requestJson } from "@/lib/post-json";
import type { Wire } from "./wire";

/** Feature flags with their settings as fields; the server checks known flags before saving. */
export function SettingsAdmin(): JSX.Element {
  const tOps = useTranslations("Ops");
  const flags = useQuery({
    queryKey: ["ops-flags"],
    queryFn: () => fetchData<Wire<FeatureFlagView>[]>("/api/admin/settings/flags", tOps("failed")),
  });
  if (flags.isPending) return <p className="text-ink-muted">{tOps("loading")}</p>;
  if (flags.isError) return <FormError message={flags.error.message} />;
  return (
    <ul className="flex flex-col gap-4">
      {flags.data.map((flag) => (
        <FlagForm key={flag.key} flag={flag} />
      ))}
    </ul>
  );
}

function FlagForm({ flag }: { readonly flag: Wire<FeatureFlagView> }): JSX.Element {
  const t = useTranslations("Ops.settings");
  const tOps = useTranslations("Ops");
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(flag.enabled);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(flag.rollout).map(([key, value]) => [key, String(value)])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const help = t.has(`flagHelp.${flag.key}`) ? t(`flagHelp.${flag.key}`) : flag.description;

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setSaved(false);
    // Numbers stay numbers; everything else (e.g. "accept") stays text.
    const rollout = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : value,
      ]),
    );
    const result = await requestJson<unknown>(
      "PUT",
      `/api/admin/settings/flags/${flag.key}`,
      { enabled, rollout },
      tOps("failed"),
    );
    setBusy(false);
    if (result.ok) setSaved(true);
    else setError(result.message);
    void queryClient.invalidateQueries({ queryKey: ["ops-flags"] });
  };

  return (
    <li className="border-border flex flex-col gap-3 rounded-xl border p-4" data-flag={flag.key}>
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-ink flex-1 font-mono text-lg font-bold">{flag.key}</h3>
        <label className="text-ink flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            className="size-5"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {t("enabled")}
        </label>
      </div>
      {help ? <p className="text-ink-muted text-sm">{help}</p> : null}
      {Object.keys(values).length > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Object.entries(values).map(([key, value]) => (
            <label key={key} className="text-ink flex flex-col gap-1 text-xs font-semibold">
              <span className="font-mono">{key}</span>
              <input
                value={value}
                name={key}
                onChange={(e) => setValues((current) => ({ ...current, [key]: e.target.value }))}
                className="border-border min-h-tap rounded-lg border px-3 text-sm font-normal"
              />
            </label>
          ))}
        </div>
      ) : null}
      {error ? <FormError message={error} /> : null}
      {saved ? (
        <p role="status" className="text-brand-800 font-semibold">
          {tOps("saved")}
        </p>
      ) : null}
      <Button disabled={busy} onClick={() => void save()}>
        {busy ? tOps("saving") : tOps("save")}
      </Button>
    </li>
  );
}
