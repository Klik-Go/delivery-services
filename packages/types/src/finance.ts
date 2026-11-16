import { z } from "zod";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

/** A settlement week, named by its Monday (YYYY-MM-DD, Asia/Manila). */
export const WeekStartSchema = z.object({
  week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Use a date like 2026-11-09." }),
});

/** PUT /api/merchant/:id/payouts/account and /api/rider/payouts/account */
export const PayoutAccountSchema = z
  .object({
    method: z.enum(["gcash", "maya", "bank"]),
    accountName: text(2, 120),
    accountNumber: z
      .string()
      .trim()
      .regex(/^[0-9][0-9 -]{5,33}$/, {
        message: "Use the account or mobile number (digits only).",
      }),
    bankName: text(2, 80).optional(),
  })
  .refine((a) => a.method !== "bank" || a.bankName !== undefined, {
    path: ["bankName"],
    message: "Which bank?",
  });
export type PayoutAccountInput = z.infer<typeof PayoutAccountSchema>;

/** POST /api/admin/finance/payouts/:id/paid — the transfer's reference number. */
export const PayoutPaidSchema = z.object({ reference: text(2, 100) });

/** POST /api/admin/finance/payouts/:id/failed */
export const PayoutFailedSchema = z.object({ reason: text(3, 300) });

/** POST /api/admin/finance/cash — cash a rider handed in. */
export const CashHandInSchema = z.object({
  riderId: z.uuid(),
  amountCentavos: z.number().int().positive().max(10_000_000),
  reference: text(2, 100),
});
export type CashHandInInput = z.infer<typeof CashHandInSchema>;
