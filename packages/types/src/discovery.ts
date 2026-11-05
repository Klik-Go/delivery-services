import { z } from "zod";
import { MERCHANT_CATEGORIES } from "./domain";
import { LatLngSchema } from "./merchant";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

/** PUT /api/location — where to deliver (a pin), kept in a cookie for guests and customers. */
export const DeliveryLocationSchema = z.object({
  location: LatLngSchema,
  /** Short label shown in the "Deliver to" chip, e.g. "Home" or a street. */
  label: text(1, 60).optional(),
});
export type DeliveryLocationInput = z.infer<typeof DeliveryLocationSchema>;

/** POST /api/geo/serviceability */
export const ServiceabilitySchema = z.object({ location: LatLngSchema });

/** POST /api/waitlist — out-of-zone customers ask Klik Go to open near them. */
export const WaitlistSchema = z.object({
  name: text(1, 80),
  phone: text(7, 20),
  email: z.email().max(254).optional().or(z.literal("")),
  barangay: text(1, 100),
  city: text(0, 100).optional(),
  location: LatLngSchema,
});
export type WaitlistInput = z.infer<typeof WaitlistSchema>;

/** POST /api/addresses — a saved address needs a pin, a landmark and a contact number. */
export const AddressInputSchema = z.object({
  label: text(1, 40).default("Home"),
  location: LatLngSchema,
  street: text(0, 200).optional(),
  landmark: text(3, 200),
  barangay: text(1, 100),
  city: text(1, 100),
  notes: text(0, 300).optional(),
  contactPhone: text(7, 20),
  isDefault: z.boolean().default(true),
});
export type AddressInput = z.infer<typeof AddressInputSchema>;
export type AddressFormValues = z.input<typeof AddressInputSchema>;

export const SEARCH_SORTS = ["relevance", "distance"] as const;

/** GET /api/search?q=…&category=…&openNow=true&sort=distance */
export const SearchQuerySchema = z.object({
  q: text(1, 80),
  category: z.enum(MERCHANT_CATEGORIES).optional(),
  openNow: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  sort: z.enum(SEARCH_SORTS).default("relevance"),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/** GET /api/geo/autocomplete?q=…&session=… (session token groups keystrokes for billing). */
export const AutocompleteQuerySchema = z.object({
  q: text(2, 120),
  session: z.uuid(),
});

/** GET /api/geo/place?id=…&session=… */
export const PlaceQuerySchema = z.object({
  id: z.string().trim().min(1).max(300),
  session: z.uuid(),
});

/** One cart line as the browser sends it: ids only, never prices (the server prices everything). */
export const CartLineSchema = z.object({
  itemId: z.uuid(),
  quantity: z.number().int().min(1).max(50),
  optionIds: z.array(z.uuid()).max(30).default([]),
});

/** POST /api/cart/quote */
export const CartQuoteRequestSchema = z.object({
  merchantId: z.uuid(),
  items: z.array(CartLineSchema).min(1).max(50),
  dropoff: LatLngSchema,
});
export type CartQuoteRequest = z.infer<typeof CartQuoteRequestSchema>;
