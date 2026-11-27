"use client";

import { formatPeso, type RewardsSummary } from "@klikgo/core";
import { Button } from "@klikgo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import type { Wire } from "@/components/admin/wire";
import { fetchData, postJson } from "@/lib/post-json";

/**
 * Rewards (docs/BUSINESS.md §4.2, §9.2.1): the customer's referral code to share, a friend's code
 * box for new customers, the stamp card and their vouchers with a link to use one at checkout.
 */
export function RewardsView(): JSX.Element {
  const t = useTranslations("Retention.rewards");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const rewards = useQuery({
    queryKey: ["rewards"],
    queryFn: () => fetchData<Wire<RewardsSummary>>("/api/rewards", t("failed")),
  });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (rewards.isPending) return <p className="text-ink-muted">{t("loading")}</p>;
  if (rewards.isError) return <FormError message={rewards.error.message} />;
  const r = rewards.data;
  const reward = formatPeso(r.rewardCentavos);
  const date = new Intl.DateTimeFormat(locale === "fil" ? "fil-PH" : "en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
  });

  const share = async (): Promise<void> => {
    const text = t("shareText", { code: r.referralCode, amount: reward });
    try {
      if (typeof navigator.share === "function") await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(r.referralCode);
        setCopied(true);
      }
    } catch {
      // The person closed the share sheet: nothing to do.
    }
  };

  const enter = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await postJson<unknown>("/api/rewards/referral", { code }, t("failed"));
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setCode("");
    void queryClient.invalidateQueries({ queryKey: ["rewards"] });
  };

  return (
    <div className="flex flex-col gap-5">
      <section
        className="bg-accent-400 text-ink flex flex-col gap-2 rounded-xl p-4"
        data-testid="referral-card"
      >
        <h2 className="text-lg font-bold">{t("referTitle", { amount: reward })}</h2>
        <p className="text-sm">{t("referLead", { amount: reward })}</p>
        <p className="font-display text-3xl tracking-widest" data-testid="referral-code">
          {r.referralCode}
        </p>
        <Button variant="secondary" onClick={() => void share()}>
          {t("share")}
        </Button>
        {copied ? (
          <p role="status" className="text-sm font-semibold">
            {t("copied")}
          </p>
        ) : null}
        <p className="text-sm">
          {t("friends", { rewarded: r.friends.rewarded, pending: r.friends.pending })}
        </p>
      </section>

      {r.canEnterCode ? (
        <section className="border-border flex flex-col gap-2 rounded-xl border p-4">
          <h2 className="text-ink text-lg font-bold">{t("enterTitle")}</h2>
          <p className="text-ink-muted text-sm">{t("enterLead", { amount: reward })}</p>
          <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
            {t("codeLabel")}
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              maxLength={12}
              autoCapitalize="characters"
              className="border-border min-h-tap rounded-lg border px-3 font-normal tracking-widest uppercase"
            />
          </label>
          {error ? <FormError message={error} /> : null}
          <Button disabled={busy || code.trim().length < 6} onClick={() => void enter()}>
            {t("apply")}
          </Button>
        </section>
      ) : r.referredBy ? (
        <p className="text-ink-muted text-sm" data-testid="referred-status">
          {t(`referred.${r.referredBy.status}`, { amount: reward })}
        </p>
      ) : null}

      <section
        className="border-border flex flex-col gap-3 rounded-xl border p-4"
        data-testid="stamp-card"
      >
        <h2 className="text-ink text-lg font-bold">{t("stampsTitle")}</h2>
        <p className="text-ink-muted text-sm">
          {t("stampsLead", { goal: r.stamps.goal, min: formatPeso(r.stamps.minSubtotalCentavos) })}
        </p>
        <ol
          className="grid grid-cols-5 gap-2"
          aria-label={t("stampsCount", { count: r.stamps.count, goal: r.stamps.goal })}
        >
          {Array.from({ length: r.stamps.goal }, (_, i) => (
            <li
              key={i}
              className={`grid aspect-square place-items-center rounded-full text-sm font-bold ${i < r.stamps.count ? "bg-brand-800 text-white" : "bg-surface-muted text-ink-muted"}`}
            >
              {i + 1}
            </li>
          ))}
        </ol>
        <p className="text-ink text-sm font-semibold">
          {t("stampsCount", { count: r.stamps.count, goal: r.stamps.goal })}
        </p>
      </section>

      <section className="flex flex-col gap-3" data-testid="vouchers">
        <h2 className="text-ink text-lg font-bold">{t("vouchersTitle")}</h2>
        {r.vouchers.length === 0 ? (
          <p className="text-ink-muted text-sm">{t("noVouchers")}</p>
        ) : null}
        <ul className="flex flex-col gap-2">
          {r.vouchers.map((voucher) => (
            <li
              key={voucher.code}
              className="border-border flex items-center justify-between gap-3 rounded-xl border p-3"
              data-voucher={voucher.code}
            >
              <div>
                <p className="text-ink font-semibold">
                  {voucher.type === "free_delivery"
                    ? t("freeDelivery")
                    : t("amountOff", { amount: formatPeso(voucher.discountCentavos ?? 0) })}
                </p>
                <p className="text-ink-muted text-sm">
                  {voucher.code} ·{" "}
                  {voucher.used
                    ? t("used")
                    : t("until", { date: date.format(new Date(voucher.endsAt)) })}
                </p>
              </div>
              {voucher.used ? null : (
                <Link
                  href={`/checkout?promo=${voucher.code}`}
                  className="text-action min-h-tap inline-flex items-center font-semibold"
                >
                  {t("use")}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
