import { z } from "zod";

/** The legal documents people agree to (apps/web/src/app/legal). */
export const LEGAL_DOCUMENTS = ["terms", "privacy"] as const;
export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number];

/**
 * The current version (publication date) of the terms and the privacy notice. Changing a date asks
 * everyone to agree again on their next sign-in.
 */
export const LEGAL_VERSIONS: Readonly<Record<LegalDocument, string>> = {
  terms: "2026-11-23",
  privacy: "2026-11-23",
};

/** POST /api/me/consents: agreeing to the versions the person was shown. */
export const ConsentAcceptSchema = z.object({
  terms: z.literal(LEGAL_VERSIONS.terms, { message: "Please read the latest terms." }),
  privacy: z.literal(LEGAL_VERSIONS.privacy, { message: "Please read the latest privacy notice." }),
});
export type ConsentAccept = z.infer<typeof ConsentAcceptSchema>;

/** The word to type to confirm account deletion. */
export const DELETE_CONFIRMATION = "DELETE";

/** POST /api/me/delete */
export const AccountDeleteSchema = z.object({ confirm: z.string().trim().max(40) });
export type AccountDeleteInput = z.infer<typeof AccountDeleteSchema>;

/** The ordering funnel: home → store → cart → checkout → placed → paid (docs/BUILD_PLAN.md Phase 11). */
export const FUNNEL_EVENTS = [
  "home_viewed",
  "store_viewed",
  "cart_item_added",
  "checkout_started",
  "order_placed",
  "order_paid",
] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

/** POST /api/events: ids only, never names, phones or addresses. */
export const AnalyticsEventSchema = z.object({
  name: z.enum(FUNNEL_EVENTS),
  storeId: z.uuid().optional(),
  orderId: z.uuid().optional(),
  /** The page path without its query string. */
  path: z
    .string()
    .max(200)
    .regex(/^\/[A-Za-z0-9/_-]*$/, "A path without a query string.")
    .optional(),
});
export type AnalyticsEventInput = z.infer<typeof AnalyticsEventSchema>;

/** POST /api/client-errors: a crash in the browser (scrubbed again on the server). */
export const ClientErrorSchema = z.object({
  kind: z.enum(["error", "unhandledrejection", "boundary"]),
  message: z.string().trim().min(1).max(500),
  stack: z.string().max(4000).optional(),
  path: z
    .string()
    .max(200)
    .regex(/^\/[A-Za-z0-9/_\-.]*$/)
    .optional(),
  digest: z.string().max(64).optional(),
});
export type ClientErrorInput = z.infer<typeof ClientErrorSchema>;

/** Settings for the kyc_retention flag (days). */
export const KycRetentionRolloutSchema = z.object({
  rejected_days: z.number().int().min(30).max(3650),
  inactive_days: z.number().int().min(90).max(3650),
});

// ---------------------------------------------------------------------------
// Pilot launch (Phase 12)
// ---------------------------------------------------------------------------

/** POST /api/invites/redeem */
export const RedeemInviteSchema = z.object({
  code: z
    .string()
    .trim()
    .min(4, "Enter your invite code.")
    .max(20)
    .regex(/^[A-Za-z0-9 -]+$/, "Codes have letters and numbers only."),
});
export type RedeemInviteInput = z.infer<typeof RedeemInviteSchema>;

/** POST /api/admin/invites: a batch of codes for flyers or a partner store. */
export const CreateInvitesSchema = z.object({
  batch: z.string().trim().min(1, "Name the batch, e.g. Flyers Poblacion.").max(80),
  count: z.number().int().min(1).max(200),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});
export type CreateInvitesInput = z.infer<typeof CreateInvitesSchema>;

/** POST /api/admin/invites/waitlist: text codes to the oldest waiting people. */
export const InviteWaitlistSchema = z.object({
  count: z.number().int().min(1).max(200),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});
export type InviteWaitlistInput = z.infer<typeof InviteWaitlistSchema>;

/** Settings for the pilot flags. */
export const InviteOnlyRolloutSchema = z.object({
  max_customers: z.number().int().min(1).max(100_000),
});
export const PilotScopeRolloutSchema = z.object({
  categories: z.array(z.enum(["food", "grocery", "pharmacy"])).min(1),
});
