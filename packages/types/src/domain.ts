import { z } from "zod";

/**
 * Domain enums shared by the BFF, clients and tests. Each mirrors a Postgres enum in
 * supabase/migrations; packages/db/test/enums.db.test.ts fails if the two drift apart.
 */

/** Roles a user can hold (many per user, via user_roles). */
export const APP_ROLES = [
  "customer",
  "rider",
  "merchant_owner",
  "merchant_staff",
  "coordinator",
  "admin",
] as const;
export const AppRoleSchema = z.enum(APP_ROLES);
export type AppRole = z.infer<typeof AppRoleSchema>;

/** Account state of a person (profiles.status). */
export const PROFILE_STATUSES = ["active", "suspended", "deleted"] as const;
export const ProfileStatusSchema = z.enum(PROFILE_STATUSES);
export type ProfileStatus = z.infer<typeof ProfileStatusSchema>;

/** Order lifecycle (docs/BUSINESS.md §5.2, docs/ARCHITECTURE.md §4). */
export const ORDER_STATUSES = [
  "awaiting_payment",
  "placed",
  "accepted",
  "preparing",
  "ready",
  "picked_up",
  "delivered",
  "rejected",
  "cancelled",
  "failed_delivery",
] as const;
export const OrderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

/** Rider dispatch state, separate from the order status. */
export const DISPATCH_STATUSES = [
  "unassigned",
  "offered",
  "assigned",
  "at_store",
  "picked_up",
] as const;
export const DispatchStatusSchema = z.enum(DISPATCH_STATUSES);
export type DispatchStatus = z.infer<typeof DispatchStatusSchema>;

export const PAYMENT_METHODS = ["gcash", "maya", "card", "qrph", "cod"] as const;
export const PaymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const PAYMENT_STATUSES = [
  "pending",
  "processing",
  "paid",
  "failed",
  "refunded",
  "partially_refunded",
] as const;
export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const MERCHANT_CATEGORIES = ["food", "grocery", "pharmacy"] as const;
export const MerchantCategorySchema = z.enum(MERCHANT_CATEGORIES);
export type MerchantCategory = z.infer<typeof MerchantCategorySchema>;

export const MERCHANT_STATUSES = ["pending", "active", "suspended"] as const;
export const MerchantStatusSchema = z.enum(MERCHANT_STATUSES);
export type MerchantStatus = z.infer<typeof MerchantStatusSchema>;

export const VEHICLE_TYPES = ["motorcycle", "bicycle", "tricycle"] as const;
export const VehicleTypeSchema = z.enum(VEHICLE_TYPES);
export type VehicleType = z.infer<typeof VehicleTypeSchema>;

export const RIDER_STATUSES = ["pending_kyc", "active", "suspended"] as const;
export const RiderStatusSchema = z.enum(RIDER_STATUSES);
export type RiderStatus = z.infer<typeof RiderStatusSchema>;

/** Zone types and their service radius bands in km (docs/BUSINESS.md §5.5). */
export const ZONE_TYPES = ["barangay", "city", "provincial"] as const;
export const ZoneTypeSchema = z.enum(ZONE_TYPES);
export type ZoneType = z.infer<typeof ZoneTypeSchema>;
export const ZONE_RADIUS_KM: Readonly<Record<ZoneType, { min: number; max: number }>> = {
  barangay: { min: 3, max: 5 },
  city: { min: 8, max: 15 },
  provincial: { min: 20, max: 40 },
};

export const DISPATCH_OFFER_STATUSES = ["offered", "accepted", "declined", "expired"] as const;
export const DispatchOfferStatusSchema = z.enum(DISPATCH_OFFER_STATUSES);
export type DispatchOfferStatus = z.infer<typeof DispatchOfferStatusSchema>;

export const KYC_DOCUMENT_TYPES = [
  "government_id",
  "drivers_license",
  "vehicle_registration",
  "selfie_with_id",
] as const;
export const KycDocumentTypeSchema = z.enum(KYC_DOCUMENT_TYPES);
export type KycDocumentType = z.infer<typeof KycDocumentTypeSchema>;

export const KYC_STATUSES = ["pending", "approved", "rejected"] as const;
export const KycStatusSchema = z.enum(KYC_STATUSES);
export type KycStatus = z.infer<typeof KycStatusSchema>;

/** Double-entry ledger accounts (docs/BUILD_PLAN.md §2 "Data model"). */
export const LEDGER_ACCOUNTS = [
  "gateway_clearing",
  "rider_cash_on_hand",
  "merchant_payable",
  "rider_payable",
  "platform_revenue",
  "gateway_fees",
  "promo_expense",
  "customer_refunds",
] as const;
export const LedgerAccountSchema = z.enum(LEDGER_ACCOUNTS);
export type LedgerAccount = z.infer<typeof LedgerAccountSchema>;

export const LEDGER_PARTIES = ["platform", "merchant", "rider", "customer"] as const;
export const LedgerPartySchema = z.enum(LEDGER_PARTIES);
export type LedgerParty = z.infer<typeof LedgerPartySchema>;

export const PAYOUT_STATUSES = ["draft", "approved", "paid", "failed"] as const;
export const PayoutStatusSchema = z.enum(PAYOUT_STATUSES);
export type PayoutStatus = z.infer<typeof PayoutStatusSchema>;

export const RATING_TARGETS = ["merchant", "rider", "customer"] as const;
export const RatingTargetSchema = z.enum(RATING_TARGETS);
export type RatingTarget = z.infer<typeof RatingTargetSchema>;

export const PROMO_TYPES = ["percent_off", "fixed_off", "free_delivery"] as const;
export const PromoTypeSchema = z.enum(PROMO_TYPES);
export type PromoType = z.infer<typeof PromoTypeSchema>;

export const NOTIFICATION_CHANNELS = ["push", "sms", "in_app", "email"] as const;
export const NotificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const FEE_RULE_KINDS = ["delivery_distance_band", "small_order_fee", "service_fee"] as const;
export const FeeRuleKindSchema = z.enum(FEE_RULE_KINDS);
export type FeeRuleKind = z.infer<typeof FeeRuleKindSchema>;

export const MERCHANT_APPLICATION_STATUSES = ["pending", "approved", "rejected"] as const;
export const MerchantApplicationStatusSchema = z.enum(MERCHANT_APPLICATION_STATUSES);
export type MerchantApplicationStatus = z.infer<typeof MerchantApplicationStatusSchema>;

/** Every enum above, keyed by its Postgres type name (used by the DB parity test). */
export const POSTGRES_ENUMS: Readonly<Record<string, readonly string[]>> = {
  app_role: APP_ROLES,
  profile_status: PROFILE_STATUSES,
  order_status: ORDER_STATUSES,
  dispatch_status: DISPATCH_STATUSES,
  payment_method: PAYMENT_METHODS,
  payment_status: PAYMENT_STATUSES,
  merchant_category: MERCHANT_CATEGORIES,
  merchant_status: MERCHANT_STATUSES,
  vehicle_type: VEHICLE_TYPES,
  rider_status: RIDER_STATUSES,
  zone_type: ZONE_TYPES,
  dispatch_offer_status: DISPATCH_OFFER_STATUSES,
  kyc_document_type: KYC_DOCUMENT_TYPES,
  kyc_status: KYC_STATUSES,
  ledger_account: LEDGER_ACCOUNTS,
  ledger_party: LEDGER_PARTIES,
  payout_status: PAYOUT_STATUSES,
  rating_target: RATING_TARGETS,
  promo_type: PROMO_TYPES,
  notification_channel: NOTIFICATION_CHANNELS,
  fee_rule_kind: FEE_RULE_KINDS,
  merchant_application_status: MERCHANT_APPLICATION_STATUSES,
};

/**
 * Allowed order status transitions. Mirrors public.order_status_transitions; the database
 * refuses any other change (packages/db/test/orders.db.test.ts checks both agree).
 */
export const ORDER_STATUS_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  awaiting_payment: ["placed", "cancelled"],
  placed: ["accepted", "rejected", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["picked_up", "cancelled"],
  picked_up: ["delivered", "failed_delivery"],
  delivered: [],
  rejected: [],
  cancelled: [],
  failed_delivery: [],
};

/** Statuses an order may be created in. */
export const INITIAL_ORDER_STATUSES: readonly OrderStatus[] = ["awaiting_payment", "placed"];
