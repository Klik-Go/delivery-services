"use client";

import { formatPeso } from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { useTranslations } from "next-intl";
import { useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { TextField } from "@/components/auth/text-field";
import { requestJson } from "@/lib/post-json";

/**
 * The rider's Pabili float: the most cash they can spend up front on a customer's shopping list.
 * Pabili offers go only to riders whose float covers the customer's budget; 0 means no Pabili.
 */
export function PabiliFloat({
  floatCentavos,
  onSaved,
}: {
  readonly floatCentavos: number;
  readonly onSaved: () => void;
}): JSX.Element {
  const t = useTranslations("Pabili.rider");
  const [pesos, setPesos] = useState(String(Math.floor(floatCentavos / 100)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const value = Number(pesos);
  const valid = pesos.trim() !== "" && Number.isInteger(value) && value >= 0;

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await requestJson<{ floatCentavos: number }>(
      "PUT",
      "/api/rider/pabili-float",
      { floatCentavos: value * 100 },
      t("failed"),
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSaved(true);
    onSaved();
  };

  return (
    <section
      className="bg-sheet-alt flex flex-col gap-3 rounded-xl p-4"
      aria-labelledby="pabili-float-title"
      data-testid="pabili-float"
    >
      <h2 id="pabili-float-title" className="text-ink text-lg font-bold">
        {t("floatTitle")}
      </h2>
      <p className="text-ink-muted text-sm">{t("floatLead")}</p>
      <p className="text-ink text-sm" data-testid="pabili-float-current">
        {floatCentavos > 0 ? t("floatNow", { amount: formatPeso(floatCentavos) }) : t("floatOff")}
      </p>
      <form
        className="flex items-end gap-2"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) void save();
        }}
      >
        <TextField
          id="pabili-float-input"
          label={t("floatLabel")}
          inputMode="numeric"
          value={pesos}
          onChange={(event) => setPesos(event.target.value.replace(/\D/g, ""))}
        />
        <Button type="submit" variant="secondary" disabled={busy || !valid}>
          {t("floatSave")}
        </Button>
      </form>
      {saved ? (
        <p className="text-ink text-sm" role="status">
          {t("floatSaved")}
        </p>
      ) : null}
      {error ? <FormError message={error} /> : null}
    </section>
  );
}
