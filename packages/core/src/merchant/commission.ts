/** Founding partners pay no commission for their first 90 days (docs/BUSINESS.md Appendix A). */
export const FOUNDING_PARTNER_DAYS = 90;

/** Standard commission when an admin does not set one: 20% of the subtotal (Appendix A). */
export const DEFAULT_COMMISSION_BPS = 2000;

/** The commission that applies at `now`: 0 during a founding period, the agreed rate after. */
export function effectiveCommissionBps(
  merchant: { readonly commissionBps: number; readonly foundingCommissionUntil: Date | null },
  now: Date,
): number {
  return merchant.foundingCommissionUntil && now < merchant.foundingCommissionUntil
    ? 0
    : merchant.commissionBps;
}

/** When a founding period that starts at `now` ends. */
export function foundingPeriodEnd(now: Date): Date {
  return new Date(now.getTime() + FOUNDING_PARTNER_DAYS * 86_400_000);
}
