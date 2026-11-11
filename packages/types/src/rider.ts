import { z } from "zod";

/** POST /api/rider/status — go online (get offers, share location) or offline. */
export const RiderOnlineSchema = z.object({ online: z.boolean() });
export type RiderOnlineInput = z.infer<typeof RiderOnlineSchema>;

/** POST /api/rider/location — one GPS fix from the rider app (every 5–10 seconds while online). */
export const RiderLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  heading: z.number().min(0).max(360).optional(),
  speedKph: z.number().min(0).max(200).optional(),
  accuracyM: z.number().min(0).max(10_000).optional(),
});
export type RiderLocationInput = z.infer<typeof RiderLocationSchema>;

/** Photos the rider may attach as delivery proof (the private bucket accepts the same). */
export const DELIVERY_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** The bucket's limit: 2 MB. The app shrinks photos before sending them. */
export const DELIVERY_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/** POST /api/rider/jobs/:orderId/delivered — the form fields besides the photo. */
export const DeliveryProofSchema = z.object({
  pin: z
    .string()
    .trim()
    .regex(/^[0-9]{4}$/, "The PIN has 4 digits.")
    .optional(),
});
export type DeliveryProofInput = z.infer<typeof DeliveryProofSchema>;

/** The photo part of the delivery form, checked before it is stored. */
export const DeliveryPhotoSchema = z.object({
  type: z.enum(DELIVERY_PHOTO_TYPES, { message: "Send a JPEG, PNG or WebP photo." }),
  size: z
    .number()
    .int()
    .min(1, "The photo is empty.")
    .max(DELIVERY_PHOTO_MAX_BYTES, "The photo is too large (2 MB at most)."),
});
