import { z } from "zod";
import { CartQuoteRequestSchema } from "./discovery";
import { PAYMENT_METHODS, type PaymentMethod } from "./domain";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

/** Methods paid on PayMongo's hosted checkout before the order reaches the store. */
export const ONLINE_PAYMENT_METHODS = [
  "gcash",
  "maya",
  "card",
  "qrph",
] as const satisfies readonly PaymentMethod[];

/** Rider tip chips (₱10, ₱20, ₱50) and the most a custom tip may be (₱500). */
export const TIP_PRESETS_CENTAVOS = [1000, 2000, 5000] as const;
export const MAX_TIP_CENTAVOS = 50_000;

/**
 * Idempotency-Key header on POST /api/orders: the browser makes one per checkout attempt, so a
 * double tap or a retry after a network error returns the same order instead of a second one.
 */
export const IdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{16,100}$/, {
  message: "Idempotency-Key must be 16–100 letters, digits, - or _.",
});

/** Promo codes are typed in any case; stored and matched in upper case. */
export const PromoCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4,20}$/, { message: "Promo codes are 4–20 letters or digits." });

/** Where the rider goes: snapshotted onto the order so later address edits never change it. */
export const CheckoutAddressSchema = z.object({
  label: text(1, 60),
  street: text(0, 200).optional(),
  landmark: text(3, 200),
  barangay: text(0, 100).optional(),
  city: text(0, 100).optional(),
  notes: text(0, 300).optional(),
  contactPhone: text(7, 20),
});
export type CheckoutAddress = z.infer<typeof CheckoutAddressSchema>;

/** POST /api/checkout/quote — the cart quote plus promo and tip, priced by the server. */
export const CheckoutQuoteSchema = CartQuoteRequestSchema.extend({
  promoCode: PromoCodeSchema.optional(),
  tipCentavos: z.number().int().min(0).max(MAX_TIP_CENTAVOS).default(0),
});
export type CheckoutQuoteRequest = z.infer<typeof CheckoutQuoteSchema>;

/** POST /api/orders (with an Idempotency-Key header). Ids and choices only; never prices. */
export const PlaceOrderSchema = CheckoutQuoteSchema.extend({
  address: CheckoutAddressSchema,
  paymentMethod: z.enum(PAYMENT_METHODS),
  /** A delivery slot today (Asia/Manila); omitted for "as soon as possible". */
  scheduledFor: z.iso.datetime({ offset: true }).optional(),
});
export type PlaceOrderRequest = z.infer<typeof PlaceOrderSchema>;

/** POST /api/admin/orders/:id/refunds — full refund when the amount is left out. */
export const RefundRequestSchema = z.object({
  amountCentavos: z.number().int().positive().optional(),
  reason: text(3, 300),
});
export type RefundRequest = z.infer<typeof RefundRequestSchema>;
