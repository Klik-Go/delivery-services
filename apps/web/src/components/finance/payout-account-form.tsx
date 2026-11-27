"use client";

import type { PayoutAccount } from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { useTranslations } from "next-intl";
import { useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { requestJson } from "@/lib/post-json";

/** Where the money goes: GCash, Maya or a bank account, in the account holder's name. */
export function PayoutAccountForm({
  endpoint,
  account,
  onSaved,
}: {
  readonly endpoint: string;
  readonly account: PayoutAccount | null;
  readonly onSaved: () => void;
}): JSX.Element {
  const t = useTranslations("Finance.account");
  const [editing, setEditing] = useState(account === null);
  const [method, setMethod] = useState<PayoutAccount["method"]>(account?.method ?? "gcash");
  const [name, setName] = useState(account?.accountName ?? "");
  const [number, setNumber] = useState(account?.accountNumber ?? "");
  const [bank, setBank] = useState(account?.bankName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing && account) {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-2"
        data-testid="payout-account"
      >
        <p className="text-ink">
          {t(`method.${account.method}`)}
          {account.bankName ? ` (${account.bankName})` : ""} · {account.accountName} ·{" "}
          {account.accountNumber}
        </p>
        <Button variant="secondary" onClick={() => setEditing(true)}>
          {t("change")}
        </Button>
      </div>
    );
  }

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await requestJson<PayoutAccount>(
      "PUT",
      endpoint,
      {
        method,
        accountName: name,
        accountNumber: number,
        ...(method === "bank" ? { bankName: bank } : {}),
      },
      t("failed"),
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setEditing(false);
    onSaved();
  };

  return (
    <div className="flex flex-col gap-3" data-testid="payout-account-form">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="text-ink mb-1 text-sm font-semibold">{t("methodLabel")}</legend>
        {(["gcash", "maya", "bank"] as const).map((m) => (
          <label
            key={m}
            className="bg-sheet-alt text-ink min-h-tap rounded-control flex items-center gap-2 px-4"
          >
            <input
              type="radio"
              name="method"
              checked={method === m}
              onChange={() => setMethod(m)}
            />
            {t(`method.${m}`)}
          </label>
        ))}
      </fieldset>
      <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
        {t("name")}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="border-border min-h-tap rounded-lg border px-3 font-normal"
        />
      </label>
      <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
        {method === "bank" ? t("accountNumber") : t("mobileNumber")}
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          inputMode="numeric"
          maxLength={34}
          className="border-border min-h-tap rounded-lg border px-3 font-normal"
        />
      </label>
      {method === "bank" ? (
        <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
          {t("bank")}
          <input
            value={bank}
            onChange={(e) => setBank(e.target.value)}
            maxLength={80}
            className="border-border min-h-tap rounded-lg border px-3 font-normal"
          />
        </label>
      ) : null}
      <p className="text-ink-muted text-sm">{t("note")}</p>
      {error ? <FormError message={error} /> : null}
      <Button
        disabled={busy || name.trim().length < 2 || number.trim().length < 6}
        onClick={() => void save()}
      >
        {t("save")}
      </Button>
    </div>
  );
}
