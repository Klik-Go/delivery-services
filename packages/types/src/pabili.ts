import { z } from "zod";
import { CheckoutAddressSchema } from "./checkout";
import { PABILI_ITEM_STATUSES } from "./domain";
import { LatLngSchema } from "./merchant";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

/** The most lines one shopping list may ever have (the admin setting may allow fewer). */
export const PABILI_MAX_LINES = 50;

/** One line of a Pabili shopping list, in the customer's own words. */
export const PabiliLineSchema = z.object({
  description: text(1, 120),
  quantity: z.number().int().min(1).max(99),
  note: text(0, 200).optional(),
});
export type PabiliLineInput = z.infer<typeof PabiliLineSchema>;

/** POST /api/pabili/quote — the fees for a shopping list, priced by the server. */
export const PabiliQuoteSchema = z.object({
  storeName: text(1, 120),
  storeNotes: text(0, 300).optional(),
  /** Where the shop is (the customer's pin). */
  pickup: LatLngSchema,
  dropoff: LatLngSchema,
  /** The most the rider may spend on the items; the customer pays the receipt total. */
  budgetCentavos: z.number().int().positive().max(10_000_000),
  items: z.array(PabiliLineSchema).min(1, "Add at least one item.").max(PABILI_MAX_LINES),
});
export type PabiliQuoteRequest = z.infer<typeof PabiliQuoteSchema>;

/** POST /api/pabili/orders (with an Idempotency-Key header). Always cash on delivery. */
export const PlacePabiliSchema = PabiliQuoteSchema.extend({ address: CheckoutAddressSchema });
export type PlacePabiliRequest = z.infer<typeof PlacePabiliSchema>;

/** Receipt photos the rider may send (the private bucket accepts the same), up to 5 MB. */
export const RECEIPT_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const RECEIPT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** POST /api/rider/jobs/:orderId/bought — the form fields besides the receipt photo. */
export const PabiliPurchaseSchema = z.object({
  /** What the items cost in total, from the receipt. */
  itemCostCentavos: z.number().int().min(0).max(10_000_000),
  /** Each line by position: bought or unavailable. */
  items: z
    .array(
      z.object({
        position: z.number().int().min(1).max(PABILI_MAX_LINES),
        status: z.enum(PABILI_ITEM_STATUSES).exclude(["pending"]),
      }),
    )
    .min(1)
    .max(PABILI_MAX_LINES),
});
export type PabiliPurchaseInput = z.infer<typeof PabiliPurchaseSchema>;

/** The receipt photo part of the form, checked before it is stored. */
export const ReceiptPhotoSchema = z.object({
  type: z.enum(RECEIPT_PHOTO_TYPES, { message: "Send a JPEG, PNG or WebP photo." }),
  size: z
    .number()
    .int()
    .min(1, "The photo is empty.")
    .max(RECEIPT_PHOTO_MAX_BYTES, "The photo is too large (5 MB at most)."),
});

/** PUT /api/rider/pabili-float — the most cash the rider can spend up front (0 = no Pabili). */
export const PabiliFloatSchema = z.object({
  floatCentavos: z.number().int().min(0).max(1_000_000),
});
export type PabiliFloatInput = z.infer<typeof PabiliFloatSchema>;

/** The admin setting `pabili` (feature_flags.rollout). */
export const PabiliRolloutSchema = z.object({
  max_item_centavos: z.number().int().positive().max(10_000_000),
  service_fee_centavos: z.number().int().min(0).max(100_000),
  max_items: z.number().int().min(1).max(PABILI_MAX_LINES),
  max_trip_m: z.number().int().min(500).max(30_000),
});
export type PabiliRollout = z.infer<typeof PabiliRolloutSchema>;

/** The customer's Pabili form (budget typed in whole pesos); the page turns it into PlacePabili. */
export const PabiliFormSchema = z.object({
  storeName: text(1, 120),
  storeNotes: text(0, 300).optional(),
  budgetPesos: z
    .number({ message: "Enter the most the rider may spend, in pesos." })
    .int("Whole pesos only.")
    .positive("Enter the most the rider may spend, in pesos.")
    .max(100_000),
  items: z.array(PabiliLineSchema).min(1, "Add at least one item.").max(PABILI_MAX_LINES),
  address: CheckoutAddressSchema,
});
export type PabiliFormInput = z.infer<typeof PabiliFormSchema>;
