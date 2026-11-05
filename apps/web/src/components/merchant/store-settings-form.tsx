"use client";

import type { StoreSettingsInput, WeeklyHours } from "@klikgo/types";
import { WEEKDAYS } from "@klikgo/types";
import { Button } from "@klikgo/ui";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { TextField } from "@/components/auth/text-field";
import { requestJson } from "@/lib/post-json";

/** Settings as the page loads them. */
export interface StoreSettingsData {
  readonly merchantId: string;
  readonly hours: WeeklyHours;
  readonly defaultPrepMinutes: number;
  readonly acceptsCod: boolean;
  readonly serviceRadiusKm: number | null;
  readonly zoneMaxRadiusKm: number;
  readonly closures: readonly { id: string; closedOn: string; reason: string | null }[];
}

const timeClass = "border-ink-muted/40 text-ink min-h-tap rounded-xl border-2 bg-white px-2";

/** Owner-only store settings: weekly hours, prep time, cash on delivery, radius and closures. */
export function StoreSettingsForm({
  initial,
  canEdit,
}: {
  readonly initial: StoreSettingsData;
  readonly canEdit: boolean;
}): JSX.Element {
  const t = useTranslations("StoreSettings");
  const [hours, setHours] = useState<WeeklyHours>(initial.hours);
  const [prep, setPrep] = useState(String(initial.defaultPrepMinutes));
  const [cod, setCod] = useState(initial.acceptsCod);
  const [radius, setRadius] = useState(
    initial.serviceRadiusKm === null ? "" : String(initial.serviceRadiusKm),
  );
  const [closures, setClosures] = useState(initial.closures);
  const [closedOn, setClosedOn] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const base = `/api/merchant/${initial.merchantId}`;

  function setWindow(
    day: keyof WeeklyHours,
    index: number,
    field: "open" | "close",
    value: string,
  ): void {
    setHours((current) => ({
      ...current,
      [day]: current[day].map((window, i) =>
        i === index ? { ...window, [field]: value } : window,
      ),
    }));
  }

  function addWindow(day: keyof WeeklyHours): void {
    setHours((current) => ({
      ...current,
      [day]: [
        ...current[day],
        current[day].length === 0
          ? { open: "10:00", close: "14:00" }
          : { open: "17:00", close: "21:00" },
      ],
    }));
  }

  function removeWindow(day: keyof WeeklyHours, index: number): void {
    setHours((current) => ({ ...current, [day]: current[day].filter((_, i) => i !== index) }));
  }

  async function save(): Promise<void> {
    setStatus("saving");
    setError(null);
    const payload: StoreSettingsInput = {
      hours,
      defaultPrepMinutes: Number(prep),
      acceptsCod: cod,
      serviceRadiusKm: radius.trim() === "" ? null : Number(radius),
    };
    const result = await requestJson("PUT", `${base}/settings`, payload, t("ownerOnly"));
    setStatus(result.ok ? "saved" : "idle");
    if (!result.ok) setError(result.message);
  }

  async function addClosure(): Promise<void> {
    setError(null);
    const result = await requestJson<{ id: string }>(
      "POST",
      `${base}/closures`,
      { closedOn, ...(reason ? { reason } : {}) },
      t("ownerOnly"),
    );
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setClosures((current) =>
      [...current, { id: result.data.id, closedOn, reason: reason || null }].sort((a, b) =>
        a.closedOn.localeCompare(b.closedOn),
      ),
    );
    setClosedOn("");
    setReason("");
  }

  async function removeClosure(id: string): Promise<void> {
    const result = await requestJson("DELETE", `${base}/closures/${id}`, undefined, t("ownerOnly"));
    if (result.ok) setClosures((current) => current.filter((closure) => closure.id !== id));
    else setError(result.message);
  }

  return (
    <div className="flex flex-col gap-6">
      {!canEdit ? (
        <p className="bg-accent-100 text-ink rounded-xl p-3 text-sm">{t("ownerOnly")}</p>
      ) : null}
      <fieldset disabled={!canEdit} className="flex flex-col gap-3">
        <legend className="text-ink mb-2 text-xl font-bold">{t("hours")}</legend>
        {WEEKDAYS.map((day) => (
          <div key={day} className="border-brand-100 flex flex-col gap-2 border-b pb-3">
            <div className="flex items-center justify-between">
              <span className="text-ink font-semibold">{t(`days.${day}`)}</span>
              {hours[day].length === 0 ? (
                <span className="text-ink-muted text-sm">{t("closedDay")}</span>
              ) : null}
            </div>
            {hours[day].map((window, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <label className="text-ink-muted flex items-center gap-1 text-sm">
                  {t("opens")}
                  <input
                    type="time"
                    className={timeClass}
                    value={window.open}
                    onChange={(event) => setWindow(day, index, "open", event.target.value)}
                  />
                </label>
                <label className="text-ink-muted flex items-center gap-1 text-sm">
                  {t("closes")}
                  <input
                    type="time"
                    className={timeClass}
                    value={window.close}
                    onChange={(event) => setWindow(day, index, "close", event.target.value)}
                  />
                </label>
                <Button
                  variant="ghost"
                  onClick={() => removeWindow(day, index)}
                  aria-label={`${t("removeWindow")}: ${t(`days.${day}`)}`}
                >
                  <Trash2 aria-hidden className="size-5" />
                </Button>
              </div>
            ))}
            {hours[day].length < 2 ? (
              <Button variant="ghost" onClick={() => addWindow(day)} className="self-start">
                <Plus aria-hidden className="size-5" />
                {t("addWindow")}
              </Button>
            ) : null}
          </div>
        ))}
        <TextField
          label={t("prep")}
          name="defaultPrepMinutes"
          type="number"
          inputMode="numeric"
          min={1}
          max={120}
          value={prep}
          onChange={(event) => setPrep(event.target.value)}
        />
        <label className="text-ink min-h-tap flex items-center gap-2 font-semibold">
          <input
            type="checkbox"
            className="accent-brand-800 size-5"
            checked={cod}
            onChange={(event) => setCod(event.target.checked)}
          />
          {t("cod")}
        </label>
        <TextField
          label={t("radius")}
          name="serviceRadiusKm"
          type="number"
          inputMode="decimal"
          min={0.5}
          max={initial.zoneMaxRadiusKm}
          step={0.1}
          value={radius}
          aria-description={t("radiusHelp", { max: initial.zoneMaxRadiusKm })}
          onChange={(event) => setRadius(event.target.value)}
        />
        <p className="text-ink-muted -mt-2 text-sm">
          {t("radiusHelp", { max: initial.zoneMaxRadiusKm })}
        </p>
        <Button onClick={() => void save()} disabled={status === "saving"} className="self-start">
          {status === "saving" ? t("saving") : t("save")}
        </Button>
        {status === "saved" ? (
          <p aria-live="polite" className="text-brand-800 font-semibold">
            {t("saved")}
          </p>
        ) : null}
      </fieldset>

      <FormError message={error} />

      <section aria-labelledby="closures-heading" className="flex flex-col gap-3">
        <h2 id="closures-heading" className="text-ink text-xl font-bold">
          {t("closures")}
        </h2>
        {closures.length === 0 ? <p className="text-ink-muted">{t("noClosures")}</p> : null}
        <ul className="flex flex-col gap-2">
          {closures.map((closure) => (
            <li
              key={closure.id}
              className="bg-surface-muted flex items-center justify-between rounded-xl p-3"
            >
              <span className="text-ink">
                {closure.closedOn}
                {closure.reason ? ` · ${closure.reason}` : ""}
              </span>
              {canEdit ? (
                <Button variant="ghost" onClick={() => void removeClosure(closure.id)}>
                  {t("remove")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {canEdit ? (
          <div className="flex flex-wrap items-end gap-3">
            <TextField
              label={t("closureDate")}
              name="closedOn"
              type="date"
              value={closedOn}
              onChange={(event) => setClosedOn(event.target.value)}
            />
            <TextField
              label={t("closureReason")}
              name="closureReason"
              maxLength={120}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <Button variant="secondary" onClick={() => void addClosure()} disabled={!closedOn}>
              {t("addClosure")}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
