import { z } from "zod";
import { PROMO_TYPES } from "./domain";
import { PromoCodeSchema } from "./checkout";

// ---------------------------------------------------------------------------
// Ratings (docs/BUSINESS.md §5.3, docs/BUILD_PLAN.md Phase 9)
// ---------------------------------------------------------------------------

/** Quick tags per target, as keys (the app translates them). Good tags first, then problems. */
export const RATING_TAGS = {
  merchant: [
    "tasty",
    "hot_food",
    "well_packed",
    "generous",
    "cold_food",
    "missing_item",
    "wrong_item",
    "spilled",
  ],
  rider: [
    "friendly",
    "fast",
    "careful",
    "followed_notes",
    "late",
    "rude",
    "spilled",
    "hard_to_reach",
  ],
  customer: ["ready_at_door", "clear_pin", "polite", "hard_to_find", "no_answer", "rude"],
} as const;
export type RatingTargetKind = keyof typeof RATING_TAGS;

const comment = z.string().trim().max(500, "Keep comments under 500 characters.").optional();
const score = z.number().int().min(1, "Pick 1 to 5 stars.").max(5, "Pick 1 to 5 stars.");
const tagsFor = <K extends RatingTargetKind>(kind: K) =>
  z
    .array(z.enum(RATING_TAGS[kind]))
    .max(5, "Pick up to 5 tags.")
    .default([])
    .transform((tags) => [...new Set(tags)]);

/** POST /api/orders/:id/ratings — the customer rates the store and/or the rider. */
export const CustomerRatingSchema = z
  .object({
    merchant: z.object({ score, tags: tagsFor("merchant"), comment }).optional(),
    rider: z.object({ score, tags: tagsFor("rider"), comment }).optional(),
  })
  .refine((value) => value.merchant || value.rider, { message: "Rate the store or the rider." });
export type CustomerRatingInput = z.infer<typeof CustomerRatingSchema>;

/** POST /api/rider/jobs/:orderId/rating — the rider rates the customer. */
export const RiderRatingSchema = z.object({ score, tags: tagsFor("customer"), comment });
export type RiderRatingInput = z.infer<typeof RiderRatingSchema>;

// ---------------------------------------------------------------------------
// Order history and reorder
// ---------------------------------------------------------------------------

/** GET /api/orders?before=…: the customer's orders, newest first, 20 at a time. */
export const OrderHistoryQuerySchema = z.object({
  before: z.iso.datetime({ offset: true }).optional(),
});

// ---------------------------------------------------------------------------
// Referrals and devices
// ---------------------------------------------------------------------------

/** A friend's referral code, typed in any case. */
export const ReferralCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6,12}$/, { message: "Referral codes are 6–12 letters or digits." }),
});
export type ReferralCodeInput = z.infer<typeof ReferralCodeSchema>;

/**
 * X-Device-Id header: a random id the app keeps on the phone, so one handset cannot claim a promo
 * or a referral twice with different accounts. Only its hash is stored.
 */
export const DeviceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

// ---------------------------------------------------------------------------
// Admin: promo campaigns and support tickets
// ---------------------------------------------------------------------------

const peso = z.number().int().positive();

/** POST /api/admin/promos — a campaign code (vouchers are made by the platform, not here). */
export const PromoCreateSchema = z
  .object({
    code: PromoCodeSchema,
    type: z.enum(PROMO_TYPES),
    description: z.string().trim().min(1).max(120).optional(),
    discountCentavos: peso.optional(),
    discountBps: z.number().int().min(1).max(10_000).optional(),
    maxDiscountCentavos: peso.optional(),
    minSubtotalCentavos: z.number().int().min(0).default(0),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    maxRedemptions: z.number().int().positive().optional(),
    perUserLimit: z.number().int().min(1).max(20).default(1),
    budgetCentavos: peso.optional(),
    firstOrders: z.number().int().min(1).max(20).optional(),
    zoneId: z.uuid().optional(),
    merchantId: z.uuid().optional(),
  })
  .superRefine((p, ctx) => {
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: "custom", path: [path], message });
    };
    if (p.type === "percent_off" && p.discountBps === undefined)
      issue("discountBps", "Set the percent off.");
    if (p.type === "fixed_off" && p.discountCentavos === undefined)
      issue("discountCentavos", "Set the amount off.");
    if (p.type !== "percent_off" && p.discountBps !== undefined)
      issue("discountBps", "Only percent-off codes take a percent.");
    if (p.type !== "fixed_off" && p.discountCentavos !== undefined)
      issue("discountCentavos", "Only fixed-amount codes take an amount.");
    if (new Date(p.endsAt) <= new Date(p.startsAt)) issue("endsAt", "End after the start.");
  });
export type PromoCreateInput = z.infer<typeof PromoCreateSchema>;

/** POST /api/admin/promos/:id — switch a campaign on or off. */
export const PromoActiveSchema = z.object({ isActive: z.boolean() });

/** POST /api/admin/tickets/:id/resolve */
export const TicketResolveSchema = z.object({
  resolution: z.string().trim().min(3, "Say what was done.").max(300),
});
export type TicketResolveInput = z.infer<typeof TicketResolveSchema>;
