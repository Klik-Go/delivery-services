"use client";

import { Button } from "@klikgo/ui";
import { useRouter } from "next/navigation";
import { useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { postJson } from "@/lib/post-json";

/** "Pay" and "Cancel" on the local test checkout; both return to the order like PayMongo does. */
export function FakePayButtons({
  session,
  orderId,
  payLabel,
  cancelLabel,
  failedMessage,
}: {
  readonly session: string;
  readonly orderId: string;
  readonly payLabel: string;
  readonly cancelLabel: string;
  readonly failedMessage: string;
}): JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pay = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await postJson<unknown>("/api/dev/pay", { session }, failedMessage);
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      return;
    }
    router.push(`/orders/${orderId}?paid=1`);
  };
  return (
    <div className="flex flex-col gap-3">
      <Button size="lg" disabled={busy} onClick={() => void pay()}>
        {payLabel}
      </Button>
      <Button variant="secondary" asChild>
        <a href={`/orders/${orderId}?cancelled=1`}>{cancelLabel}</a>
      </Button>
      {error ? <FormError message={error} /> : null}
    </div>
  );
}
