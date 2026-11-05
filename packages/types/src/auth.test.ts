import { describe, expect, it } from "vitest";
import {
  InviteStaffSchema,
  MfaVerifySchema,
  OtpVerifySchema,
  PasswordSignInSchema,
  SendSmsHookSchema,
} from "./auth";

describe("auth API schemas", () => {
  it("accepts a 6-digit code and trims spaces", () => {
    expect(OtpVerifySchema.parse({ phone: "0917 123 4567", code: " 123456 " }).code).toBe("123456");
    expect(OtpVerifySchema.safeParse({ phone: "09171234567", code: "12345" }).success).toBe(false);
  });

  it("requires a valid email for staff sign-in", () => {
    expect(
      PasswordSignInSchema.safeParse({ email: "nena@example.test", password: "x" }).success,
    ).toBe(true);
    expect(PasswordSignInSchema.safeParse({ email: "nena", password: "x" }).success).toBe(false);
  });

  it("only invites staff roles, never customers or riders", () => {
    expect(InviteStaffSchema.safeParse({ email: "a@example.test", role: "admin" }).success).toBe(
      true,
    );
    expect(InviteStaffSchema.safeParse({ email: "a@example.test", role: "rider" }).success).toBe(
      false,
    );
    expect(
      InviteStaffSchema.safeParse({
        email: "a@example.test",
        role: "merchant_owner",
        merchantId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });

  it("lets MFA verification omit the factor (challenge the enrolled one)", () => {
    expect(MfaVerifySchema.parse({ code: "123456" })).toEqual({ code: "123456" });
  });

  it("reads the phone and code from Supabase's Send SMS hook", () => {
    const payload = SendSmsHookSchema.parse({
      user: { id: "u", phone: "639171234567" },
      sms: { otp: "482913" },
    });
    expect(payload).toEqual({ user: { phone: "639171234567" }, sms: { otp: "482913" } });
  });
});
