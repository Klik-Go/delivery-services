"use client";

import type { RiderReview } from "@klikgo/core";
import { VEHICLE_TYPES, type KycDocumentType, type VehicleType } from "@klikgo/types";
import { Button } from "@klikgo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { compressToWebp } from "@/lib/compress-image";
import { fetchData, requestJson } from "@/lib/post-json";

type Application = Omit<RiderReview, "appliedAt" | "documents" | "checklist"> & {
  checklist: {
    type: KycDocumentType;
    state: string;
    document: { rejectionReason: string | null } | null;
  }[];
};

/** The applicant's side: the application form, then the five documents with their review state. */
export function RiderApplication({
  zones,
}: {
  readonly zones: readonly { readonly id: string; readonly name: string }[];
}): JSX.Element {
  const t = useTranslations("RiderApply");
  const queryClient = useQueryClient();
  const application = useQuery({
    queryKey: ["rider-application"],
    queryFn: () => fetchData<Application | null>("/api/rider/application", t("signIn")),
  });
  const refresh = (): void =>
    void queryClient.invalidateQueries({ queryKey: ["rider-application"] });

  if (application.isPending) return <p className="text-ink-muted">…</p>;
  if (application.isError) return <FormError message={application.error.message} />;
  const app = application.data;
  if (!app) return <ApplyForm zones={zones} onDone={refresh} />;
  if (app.status === "active") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-ink font-semibold" role="status">
          {t("approved")}
        </p>
        <Link
          href="/rider"
          className="bg-brand-800 min-h-tap inline-flex items-center self-start rounded-full px-5 font-semibold text-white"
        >
          {t("openApp")}
        </Link>
      </div>
    );
  }
  if (app.status === "suspended") return <p className="text-ink">{t("suspended")}</p>;
  return (
    <section aria-labelledby="docs-heading" className="flex flex-col gap-3">
      <h2 id="docs-heading" className="text-ink text-xl font-bold">
        {t("documents")}
      </h2>
      <p className="text-ink-muted text-sm">{t("documentsLead")}</p>
      <ul className="flex flex-col gap-2" data-testid="kyc-checklist">
        {app.checklist.map((item) => (
          <DocumentRow key={item.type} item={item} onDone={refresh} />
        ))}
      </ul>
    </section>
  );
}

function ApplyForm({
  zones,
  onDone,
}: {
  readonly zones: readonly { readonly id: string; readonly name: string }[];
  readonly onDone: () => void;
}): JSX.Element {
  const t = useTranslations("RiderApply");
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? "");
  const [vehicleType, setVehicleType] = useState<VehicleType>("motorcycle");
  const [plateNo, setPlateNo] = useState("");
  const [fullName, setFullName] = useState("");
  const [payoutAccountName, setPayoutAccountName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = "border-border min-h-tap rounded-lg border px-3 font-normal";

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await requestJson<unknown>(
      "POST",
      "/api/rider/application",
      { zoneId, vehicleType, fullName, payoutAccountName, ...(plateNo.trim() ? { plateNo } : {}) },
      t("signIn"),
    );
    setBusy(false);
    if (!result.ok) setError(result.message);
    onDone();
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <label className="text-ink flex flex-col gap-1 font-semibold">
        {t("zone")}
        <select
          className={`${field} bg-surface`}
          value={zoneId}
          onChange={(e) => setZoneId(e.target.value)}
        >
          {zones.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-ink flex flex-col gap-1 font-semibold">
        {t("vehicle")}
        <select
          className={`${field} bg-surface`}
          value={vehicleType}
          onChange={(e) => setVehicleType(e.target.value as VehicleType)}
        >
          {VEHICLE_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`vehicles.${type}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="text-ink flex flex-col gap-1 font-semibold">
        {t("plate")}
        <input
          className={field}
          value={plateNo}
          onChange={(e) => setPlateNo(e.target.value)}
          maxLength={10}
        />
      </label>
      <label className="text-ink flex flex-col gap-1 font-semibold">
        {t("fullName")}
        <input
          className={field}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          maxLength={80}
          autoComplete="name"
        />
      </label>
      <label className="text-ink flex flex-col gap-1 font-semibold">
        {t("payoutName")}
        <input
          className={field}
          value={payoutAccountName}
          onChange={(e) => setPayoutAccountName(e.target.value)}
          required
          maxLength={120}
        />
      </label>
      {error ? <FormError message={error} /> : null}
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? t("applying") : t("apply")}
      </Button>
    </form>
  );
}

function DocumentRow({
  item,
  onDone,
}: {
  readonly item: Application["checklist"][number];
  readonly onDone: () => void;
}): JSX.Element {
  const t = useTranslations("RiderApply");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canUpload = item.state === "missing" || item.state === "rejected";

  const upload = async (file: File): Promise<void> => {
    setBusy(true);
    setError(null);
    // Photos are shrunk on the phone so they upload quickly on mobile data; PDFs go as they are.
    const body =
      file.type === "application/pdf" ? file : await compressToWebp(file).catch(() => file);
    const form = new FormData();
    form.set("type", item.type);
    form.set(
      "file",
      new File([body], file.type === "application/pdf" ? "doc.pdf" : "doc.webp", {
        type: body.type || file.type,
      }),
    );
    const result = await requestJson<unknown>(
      "POST",
      "/api/rider/application/documents",
      form,
      t("signIn"),
    );
    setBusy(false);
    if (!result.ok) setError(result.message);
    onDone();
  };

  return (
    <li className="bg-surface-muted flex flex-col gap-2 rounded-lg p-3" data-doc={item.type}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink flex-1 font-semibold">{t(`doc.${item.type}`)}</span>
        <span className="text-ink-muted text-sm" data-state={item.state}>
          {t(`state.${item.state}`)}
        </span>
      </div>
      {item.state === "rejected" && item.document?.rejectionReason ? (
        <p className="text-ink text-sm">
          {t("rejected", { reason: item.document.rejectionReason })}
        </p>
      ) : null}
      {canUpload ? (
        <label className="text-brand-800 text-sm font-semibold">
          {item.state === "rejected" ? t("replace") : t("upload")}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            capture="environment"
            disabled={busy}
            className="text-ink mt-1 block text-sm"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </label>
      ) : null}
      {error ? <FormError message={error} /> : null}
    </li>
  );
}
