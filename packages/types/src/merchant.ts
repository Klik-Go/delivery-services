import { z } from "zod";
import { MERCHANT_CATEGORIES } from "./domain";

/** A map pin (WGS84). */
export const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLngInput = z.infer<typeof LatLngSchema>;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

/** POST /api/partners/applications — the public "Become a partner" form (docs/BUSINESS.md §5.4). */
export const MerchantApplicationSchema = z.object({
  businessName: text(2, 80),
  ownerName: text(2, 80),
  /** Normalised to +639XXXXXXXXX by the service. */
  phone: text(7, 20),
  email: z.email().max(254),
  category: z.enum(MERCHANT_CATEGORIES),
  barangay: text(1, 100),
  city: text(1, 100),
  addressLine: text(0, 200).optional(),
  location: LatLngSchema,
  /** Honeypot: invisible to people, filled in by bots. Any value means the form is ignored. */
  website: z.string().max(200).optional(),
});
export type MerchantApplicationInput = z.infer<typeof MerchantApplicationSchema>;

/** POST /api/admin/merchant-applications/:id/approve */
export const ApproveApplicationSchema = z.object({
  /** Agreed commission in basis points (2000 = 20%, docs/BUSINESS.md Appendix A). */
  commissionBps: z.number().int().min(0).max(10_000).default(2000),
  /** Founding partners pay 0% for their first 90 days (Appendix A "first-90-day" terms). */
  foundingPartner: z.boolean().default(false),
});
export type ApproveApplicationInput = z.infer<typeof ApproveApplicationSchema>;

/** POST /api/admin/merchant-applications/:id/reject */
export const RejectApplicationSchema = z.object({ reason: text(1, 300) });

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (value: string): number => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

/** One opening window on a day, in Asia/Manila local time ("07:00"–"14:00"). */
export const OpeningWindowSchema = z
  .object({ open: z.string().regex(CLOCK), close: z.string().regex(CLOCK) })
  .refine((window) => minutes(window.close) > minutes(window.open), {
    message: "Closing time must be after opening time.",
    path: ["close"],
  });
export type OpeningWindow = z.infer<typeof OpeningWindowSchema>;

const day = z.array(OpeningWindowSchema).max(2).default([]);

/** Weekly hours: up to two windows a day (e.g. lunch and dinner); an empty day means closed. */
export const WeeklyHoursSchema = z
  .object({ mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day })
  .refine(
    (week) =>
      WEEKDAYS.every((weekday) => {
        const [first, second] = week[weekday];
        return !first || !second || minutes(second.open) >= minutes(first.close);
      }),
    { message: "A day's second window must start after the first one closes." },
  );
export type WeeklyHours = z.infer<typeof WeeklyHoursSchema>;

/** PUT /api/merchant/:merchantId/settings — owner-managed store settings (§9.2.2). */
export const StoreSettingsSchema = z.object({
  hours: WeeklyHoursSchema,
  defaultPrepMinutes: z.number().int().min(1).max(120),
  acceptsCod: z.boolean(),
  /** Kilometres, one decimal; null means "the zone maximum". */
  serviceRadiusKm: z
    .number()
    .min(0.5)
    .max(40)
    .refine((km) => Math.abs(km * 10 - Math.round(km * 10)) < 1e-9, "Use at most one decimal.")
    .nullable(),
});
export type StoreSettingsInput = z.infer<typeof StoreSettingsSchema>;

/** PUT /api/merchant/:merchantId/open */
export const StoreOpenSchema = z.object({ isOpen: z.boolean() });

/** POST /api/merchant/:merchantId/closures — a holiday closure. */
export const StoreClosureSchema = z.object({
  closedOn: z.iso.date(),
  reason: text(0, 120).optional(),
});
export type StoreClosureInput = z.infer<typeof StoreClosureSchema>;
