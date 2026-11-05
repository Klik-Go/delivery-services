import { MemoryLogger } from "@klikgo/core/testing";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { SupabaseAuthGateway } from "./supabase-auth-gateway";
import { SupabaseStaffAccountGateway } from "./supabase-staff-account-gateway";

type AuthStub = Record<string, unknown>;
const clientWith = (auth: AuthStub): SupabaseClient => ({ auth }) as unknown as SupabaseClient;
const authError = (status: number, code = "x", message = "boom") => ({
  status,
  code,
  message,
  name: "AuthApiError",
});

describe("SupabaseAuthGateway", () => {
  it("asks Supabase to text a code and maps Supabase's own rate limit to RATE_LIMITED", async () => {
    const signInWithOtp = vi
      .fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: authError(429) });
    const gateway = new SupabaseAuthGateway(clientWith({ signInWithOtp }), new MemoryLogger());
    expect((await gateway.sendPhoneOtp("+639171234567")).ok).toBe(true);
    expect(signInWithOtp).toHaveBeenCalledWith({
      phone: "+639171234567",
      options: { shouldCreateUser: true, channel: "sms" },
    });
    const limited = await gateway.sendPhoneOtp("+639171234567");
    expect(!limited.ok && limited.error.code).toBe("RATE_LIMITED");
  });

  it("turns a wrong code into one friendly message", async () => {
    const verifyOtp = vi
      .fn()
      .mockResolvedValue({ data: { user: null }, error: authError(403, "otp_expired") });
    const gateway = new SupabaseAuthGateway(clientWith({ verifyOtp }), new MemoryLogger());
    const result = await gateway.verifyPhoneOtp("+639171234567", "000000");
    expect(!result.ok && result.error.message).toBe("That code is wrong or has expired.");
  });

  it("never reveals whether the email or the password was wrong", async () => {
    const signInWithPassword = vi
      .fn()
      .mockResolvedValue({ data: { user: null }, error: authError(400, "invalid_credentials") });
    const gateway = new SupabaseAuthGateway(clientWith({ signInWithPassword }), new MemoryLogger());
    const result = await gateway.signInWithPassword("a@example.test", "x");
    expect(!result.ok && result.error.message).toBe("Wrong email or password.");
  });

  it("reports the session's assurance level and its verified TOTP factor", async () => {
    const mfa = {
      getAuthenticatorAssuranceLevel: vi
        .fn()
        .mockResolvedValue({ data: { currentLevel: "aal2" }, error: null }),
      listFactors: vi.fn().mockResolvedValue({
        data: { totp: [{ id: "f-1", status: "verified" }], all: [] },
        error: null,
      }),
    };
    const getSession = vi
      .fn()
      .mockResolvedValue({ data: { session: { access_token: "jwt" } }, error: null });
    const gateway = new SupabaseAuthGateway(clientWith({ mfa, getSession }), new MemoryLogger());
    expect(await gateway.mfaStatus()).toEqual({
      ok: true,
      value: { aal: "aal2", verifiedFactorId: "f-1" },
    });
    // The token is handed over so Supabase verifies it rather than trusting the cookie.
    expect(mfa.getAuthenticatorAssuranceLevel).toHaveBeenCalledWith("jwt");
  });

  it("treats a missing session as signed out when reading the second-factor status", async () => {
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const gateway = new SupabaseAuthGateway(clientWith({ getSession }), new MemoryLogger());
    const result = await gateway.mfaStatus();
    expect(!result.ok && result.error.code).toBe("UNAUTHORIZED");
  });

  it("removes abandoned unverified factors before enrolling a new authenticator", async () => {
    const mfa = {
      listFactors: vi.fn().mockResolvedValue({
        data: { totp: [], all: [{ id: "old", factor_type: "totp", status: "unverified" }] },
        error: null,
      }),
      unenroll: vi.fn().mockResolvedValue({ error: null }),
      enroll: vi.fn().mockResolvedValue({
        data: { id: "f-2", totp: { qr_code: "data:x", secret: "ABC" } },
        error: null,
      }),
    };
    const gateway = new SupabaseAuthGateway(clientWith({ mfa }), new MemoryLogger());
    expect(await gateway.enrollTotp()).toEqual({
      ok: true,
      value: { factorId: "f-2", qrCode: "data:x", secret: "ABC" },
    });
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "old" });
  });

  it("maps weak passwords to a validation error and signs out", async () => {
    const updateUser = vi
      .fn()
      .mockResolvedValue({ error: authError(422, "weak_password", "Password is too weak") });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const gateway = new SupabaseAuthGateway(
      clientWith({ updateUser, signOut }),
      new MemoryLogger(),
    );
    const weak = await gateway.updatePassword("password");
    expect(!weak.ok && weak.error.code).toBe("VALIDATION_FAILED");
    expect((await gateway.signOut()).ok).toBe(true);
  });
});

describe("SupabaseStaffAccountGateway", () => {
  it("creates an invited account and returns the token hash for Klik Go's own link", async () => {
    const generateLink = vi.fn().mockResolvedValue({
      data: { user: { id: "u-9" }, properties: { hashed_token: "abc123" } },
      error: null,
    });
    const gateway = new SupabaseStaffAccountGateway(
      clientWith({ admin: { generateLink } }),
      new MemoryLogger(),
    );
    expect(await gateway.createInvite("nena@example.test")).toEqual({
      ok: true,
      value: { userId: "u-9", tokenHash: "abc123" },
    });
    expect(generateLink).toHaveBeenCalledWith({ type: "invite", email: "nena@example.test" });
  });

  it("reports an email that already has an account as a conflict", async () => {
    const generateLink = vi.fn().mockResolvedValue({
      data: null,
      error: authError(422, "email_exists", "already registered"),
    });
    const gateway = new SupabaseStaffAccountGateway(
      clientWith({ admin: { generateLink } }),
      new MemoryLogger(),
    );
    const result = await gateway.createInvite("taken@example.test");
    expect(!result.ok && result.error.code).toBe("CONFLICT");
  });
});
