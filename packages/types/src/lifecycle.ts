import { z } from "zod";

const reason = z.string().trim().min(3, "Please give a short reason.").max(300);

/** Prep-time chips on the store's board (minutes). */
export const PREP_TIME_CHIPS = [10, 15, 20, 30] as const;

/** POST /api/orders/:id/accept — the store confirms and says how long cooking takes. */
export const AcceptOrderSchema = z.object({
  prepMinutes: z.number().int().min(5).max(120),
});
export type AcceptOrder = z.infer<typeof AcceptOrderSchema>;

/** Reasons a store can pick when it cannot take an order (free text is allowed too). */
export const REJECT_REASONS = [
  "Too busy right now",
  "An item is sold out",
  "Closing soon",
  "Can't deliver to this address",
] as const;

/** POST /api/orders/:id/reject */
export const RejectOrderSchema = z.object({ reason });
export type RejectOrder = z.infer<typeof RejectOrderSchema>;

/** POST /api/orders/:id/cancel — the reason is optional for customers. */
export const CancelOrderSchema = z.object({ reason: reason.optional() });
export type CancelOrder = z.infer<typeof CancelOrderSchema>;

/** POST /api/push/subscriptions — a browser's Web Push subscription (PushSubscription.toJSON()). */
export const PushSubscriptionSchema = z.object({
  endpoint: z
    .url()
    .max(1000)
    .refine((url) => url.startsWith("https://"), "Push endpoints use https."),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{40,200}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{10,100}$/),
  }),
});
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionSchema>;

/** DELETE /api/push/subscriptions */
export const PushUnsubscribeSchema = z.object({ endpoint: z.url().max(1000) });
