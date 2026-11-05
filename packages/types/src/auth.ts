import { z } from "zod";

/** POST /api/auth/otp: the number is normalised to +63 by the server (core). */
export const OtpRequestSchema = z.object({
  phone: z.string().trim().min(1, "Enter your mobile number.").max(32),
});

/** POST /api/auth/otp/verify */
export const OtpVerifySchema = z.object({
  phone: z.string().trim().min(1).max(32),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code."),
});

/** POST /api/auth/password: staff first factor. */
export const PasswordSignInSchema = z.object({
  email: z.email("Enter a valid email address.").max(254),
  password: z.string().min(1, "Enter your password.").max(128),
});

/** POST /api/auth/set-password: length rules live in core (StaffAuthService). */
export const SetPasswordSchema = z.object({ password: z.string().max(128) });

/** POST /api/auth/mfa/verify: factorId is null when challenging an already enrolled factor. */
export const MfaVerifySchema = z.object({
  factorId: z.uuid().nullable().optional(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code."),
});

/** Staff roles an admin can invite (customers and riders sign up with their phone). */
export const INVITABLE_ROLES = [
  "merchant_owner",
  "merchant_staff",
  "coordinator",
  "admin",
] as const;

/** POST /api/admin/invites */
export const InviteStaffSchema = z.object({
  email: z.email("Enter a valid email address.").max(254),
  role: z.enum(INVITABLE_ROLES),
  merchantId: z.uuid().nullable().optional(),
  zoneId: z.uuid().nullable().optional(),
});

/** Supabase Auth "Send SMS" hook payload (only the fields Klik Go needs). */
export const SendSmsHookSchema = z.object({
  user: z.object({ phone: z.string().min(8).max(20) }),
  sms: z.object({ otp: z.string().regex(/^\d{4,10}$/) }),
});

export type OtpRequest = z.infer<typeof OtpRequestSchema>;
export type OtpVerify = z.infer<typeof OtpVerifySchema>;
export type PasswordSignIn = z.infer<typeof PasswordSignInSchema>;
export type SetPassword = z.infer<typeof SetPasswordSchema>;
export type MfaVerify = z.infer<typeof MfaVerifySchema>;
export type InviteStaff = z.infer<typeof InviteStaffSchema>;

/** One-time link kinds Supabase can mint for `/auth/confirm` (token-hash flow). */
export const CONFIRM_LINK_TYPES = [
  "invite",
  "recovery",
  "email",
  "magiclink",
  "email_change",
] as const;

/** Query string of `/auth/confirm?token_hash=…&type=…&next=…`. */
export const ConfirmLinkQuerySchema = z.object({
  token_hash: z.string().min(1).max(512),
  type: z.enum(CONFIRM_LINK_TYPES),
  next: z.string().max(512).optional(),
});
export type ConfirmLinkQuery = z.infer<typeof ConfirmLinkQuerySchema>;
