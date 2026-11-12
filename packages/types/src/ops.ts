import { z } from "zod";
import { FeeRuleKindSchema, KycDocumentTypeSchema, VehicleTypeSchema } from "./domain";

/** Every console action that changes something carries a short reason for the audit log. */
export const OpsReasonSchema = z
  .string()
  .trim()
  .min(3, "Please give a short reason.")
  .max(300, "Keep the reason under 300 characters.");

/** POST /api/admin/orders/:id/assign — give the job to a rider (or move it to another). */
export const AssignRiderSchema = z.object({ riderId: z.uuid(), reason: OpsReasonSchema });
export type AssignRiderInput = z.infer<typeof AssignRiderSchema>;

/** POST /api/admin/orders/:id/cancel */
export const OpsCancelSchema = z.object({ reason: OpsReasonSchema });
export type OpsCancelInput = z.infer<typeof OpsCancelSchema>;

/** POST /api/admin/orders/:id/notes */
export const SupportNoteSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write a note first.")
    .max(1000, "Keep notes under 1,000 characters."),
});
export type SupportNoteInput = z.infer<typeof SupportNoteSchema>;

// ---------------------------------------------------------------------------
// Zones and fees (admins)
// ---------------------------------------------------------------------------

const centavos = z.number().int().min(0).max(1_000_000);

/** PATCH /api/admin/zones/:id */
export const ZoneUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    baseFeeCentavos: centavos.optional(),
    perKmCentavos: centavos.optional(),
    maxRadiusKm: z.number().min(0.5).max(60).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, "Nothing to change.");
export type ZoneUpdateInput = z.infer<typeof ZoneUpdateSchema>;

/** One point of a zone's outline as [longitude, latitude] (GeoJSON order). */
export const LngLatSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

/** PUT /api/admin/zones/:id/area — the outline as a list of corners (closed automatically). */
export const ZoneAreaSchema = z.object({
  ring: z
    .array(LngLatSchema)
    .min(3, "Draw at least 3 corners.")
    .max(200, "Use at most 200 corners."),
});
export type ZoneAreaInput = z.infer<typeof ZoneAreaSchema>;

/** PUT /api/admin/zones/:id/coordinator — null removes the coordinator. */
export const ZoneCoordinatorSchema = z.object({ userId: z.uuid().nullable() });

/** POST /api/admin/zones/:id/fee-rules and PATCH /api/admin/fee-rules/:id */
export const FeeRuleSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    kind: FeeRuleKindSchema,
    minDistanceM: z.number().int().min(0).max(100_000).nullable(),
    maxDistanceM: z.number().int().min(1).max(100_000).nullable(),
    minSubtotalCentavos: centavos.nullable(),
    feeCentavos: centavos,
    priority: z.number().int().min(0).max(1000),
    isActive: z.boolean(),
  })
  .refine(
    (rule) =>
      rule.minDistanceM === null ||
      rule.maxDistanceM === null ||
      rule.maxDistanceM > rule.minDistanceM,
    { message: "The band must end after it starts.", path: ["maxDistanceM"] },
  );
export type FeeRuleInput = z.infer<typeof FeeRuleSchema>;
export const FeeRulePatchSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    feeCentavos: centavos.optional(),
    minDistanceM: z.number().int().min(0).max(100_000).nullable().optional(),
    maxDistanceM: z.number().int().min(1).max(100_000).nullable().optional(),
    minSubtotalCentavos: centavos.nullable().optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, "Nothing to change.");
export type FeeRulePatchInput = z.infer<typeof FeeRulePatchSchema>;

// ---------------------------------------------------------------------------
// Stores and riders
// ---------------------------------------------------------------------------

/** POST /api/admin/merchants/:id/status */
export const MerchantStatusChangeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("suspended"), reason: OpsReasonSchema }),
  z.object({ status: z.literal("active"), reason: OpsReasonSchema.optional() }),
]);
export type MerchantStatusChangeInput = z.infer<typeof MerchantStatusChangeSchema>;

/** POST /api/admin/merchants/:id/commission — the new rate and when it starts. */
export const MerchantCommissionSchema = z.object({
  commissionBps: z.number().int().min(0).max(5000),
  effectiveFrom: z.iso.datetime({ offset: true }),
  reason: OpsReasonSchema,
});
export type MerchantCommissionInput = z.infer<typeof MerchantCommissionSchema>;

/** POST /api/admin/kyc/:documentId — accept or reject one document. */
export const KycDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve") }),
  z.object({ decision: z.literal("reject"), reason: OpsReasonSchema }),
]);
export type KycDecisionInput = z.infer<typeof KycDecisionSchema>;

/** POST /api/admin/riders/:id/status */
export const RiderStatusChangeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("active"), reason: OpsReasonSchema.optional() }),
  z.object({ status: z.literal("suspended"), reason: OpsReasonSchema }),
]);
export type RiderStatusChangeInput = z.infer<typeof RiderStatusChangeSchema>;

/** POST /api/rider/application — a signed-in person applies to ride in a zone. */
export const RiderApplicationSchema = z.object({
  zoneId: z.uuid(),
  vehicleType: VehicleTypeSchema,
  plateNo: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9 -]{2,10}$/, "Use the plate as printed, e.g. NAB 1234.")
    .optional(),
  fullName: z.string().trim().min(2).max(80),
  payoutAccountName: z.string().trim().min(2, "Enter the GCash/Maya account name.").max(120),
});
export type RiderApplicationInput = z.infer<typeof RiderApplicationSchema>;

/** Files a rider may upload for KYC (the private rider-kyc bucket allows the same). */
export const KYC_FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const KYC_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const KycUploadSchema = z.object({
  type: KycDocumentTypeSchema,
  file: z.object({
    type: z.enum(KYC_FILE_TYPES, { message: "Send a photo (JPEG, PNG, WebP) or a PDF." }),
    size: z
      .number()
      .int()
      .min(1, "The file is empty.")
      .max(KYC_FILE_MAX_BYTES, "The file is too large (10 MB at most)."),
  }),
});

// ---------------------------------------------------------------------------
// Settings (admins)
// ---------------------------------------------------------------------------

/** The `dispatch` flag's settings (docs/ARCHITECTURE.md §4h). */
export const DispatchRolloutSchema = z.strictObject({
  offer_seconds: z.number().int().min(10, "Riders need at least 10 seconds.").max(120),
  max_attempts: z.number().int().min(1).max(20),
  max_distance_m: z.number().int().min(500).max(30_000),
  start: z.enum(["accept", "before_ready"]),
  lead_minutes: z.number().int().min(0).max(60),
  pin_threshold_centavos: z.number().int().min(0).max(10_000_000),
  rider_base_centavos: centavos,
  rider_per_km_centavos: centavos,
  rider_free_km: z.number().min(0).max(20),
  avg_speed_kph: z.number().min(5).max(80),
});

/** The `merchant_sla` flag's settings (Phase 6): text, alert and cancel, in that order. */
export const MerchantSlaRolloutSchema = z
  .strictObject({
    sms_after_s: z.number().int().min(15).max(600),
    flag_after_s: z.number().int().min(30).max(900),
    cancel_after_s: z.number().int().min(60).max(1800),
  })
  .refine((r) => r.sms_after_s < r.flag_after_s && r.flag_after_s < r.cancel_after_s, {
    message: "Text first, then alert, then cancel.",
  });

/** Flags whose settings have a known shape; others keep a free-form object. */
export const FLAG_ROLLOUT_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  dispatch: DispatchRolloutSchema,
  merchant_sla: MerchantSlaRolloutSchema,
};

/** PUT /api/admin/feature-flags/:key */
export const FeatureFlagUpdateSchema = z.object({
  enabled: z.boolean(),
  rollout: z.record(z.string(), z.unknown()),
});
export type FeatureFlagUpdateInput = z.infer<typeof FeatureFlagUpdateSchema>;
