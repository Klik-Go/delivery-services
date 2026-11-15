"use client";

import type { ReorderPlan } from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { useCart } from "@/lib/cart-store";
import { postJson } from "@/lib/post-json";

/**
 * "Order again": prices the same items today, fills the cart with what can still be ordered and
 * lists what can't (gone from the menu, sold out, choices changed) before going to the cart.
 */
export function ReorderButton({
  orderId,
  merchantName,
  variant = "primary",
}: {
  readonly orderId: string;
  readonly merchantName: string;
  readonly variant?: "primary" | "secondary";
}): JSX.Element {
  const t = useTranslations("Retention.reorder");
  const router = useRouter();
  const fill = useCart((state) => state.fill);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<ReorderPlan["lines"] | null>(null);

  const reorder = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await postJson<ReorderPlan>(`/api/orders/${orderId}/reorder`, {}, t("failed"));
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const plan = result.data;
    const available = plan.lines.filter((line) => line.available && line.itemId);
    const unavailable = plan.lines.filter((line) => !line.available);
    if (available.length === 0) {
      setMissing(unavailable);
      setError(t("nothing"));
      return;
    }
    fill(
      {
        merchantId: plan.merchantId,
        name: plan.quote?.merchantName ?? merchantName,
        slug: plan.merchantSlug,
      },
      available.map((line) => ({
        itemId: line.itemId ?? "",
        name: line.name,
        optionIds: line.optionIds,
        optionNames: [],
        quantity: line.quantity,
      })),
    );
    if (unavailable.length > 0) setMissing(unavailable);
    else router.push("/cart");
  };

  return (
    <div className="flex flex-col gap-2">
      <Button variant={variant} disabled={busy} onClick={() => void reorder()}>
        {t("button")}
      </Button>
      {error ? <FormError message={error} /> : null}
      {missing && missing.length > 0 ? (
        <div
          className="bg-surface-muted flex flex-col gap-2 rounded-xl p-3"
          role="status"
          data-testid="reorder-missing"
        >
          <p className="text-ink font-semibold">{t("missingTitle")}</p>
          <ul className="text-ink list-disc pl-5 text-sm">
            {missing.map((line, index) => (
              <li key={`${line.name}-${String(index)}`}>
                {t("missingLine", { quantity: line.quantity, name: line.name })} ·{" "}
                {t(`issue.${line.issue ?? "removed"}`)}
              </li>
            ))}
          </ul>
          {!error ? (
            <Button variant="secondary" onClick={() => router.push("/cart")}>
              {t("toCart")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
