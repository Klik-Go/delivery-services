import { beforeEach, describe, expect, it } from "vitest";
import {
  FakeAuthGateway,
  FakePhoneAccountAdmin,
  InMemoryRateLimiter,
  InMemoryUserRoleRepository,
  MemoryLogger,
} from "../testing";
import { PhoneOtpService } from "./phone-otp-service";
import { PlaceholderPhoneSignIn } from "./placeholder-sign-in";

const CODE = "424242";

describe("placeholder sign-in (while SMS is not switched on)", () => {
  let accounts: FakePhoneAccountAdmin;
  let gateway: FakeAuthGateway;
  let roles: InMemoryUserRoleRepository;
  let logger: MemoryLogger;
  let service: PhoneOtpService;

  beforeEach(() => {
    accounts = new FakePhoneAccountAdmin();
    gateway = new FakeAuthGateway(accounts);
    roles = new InMemoryUserRoleRepository();
    logger = new MemoryLogger();
    const placeholder = new PlaceholderPhoneSignIn({
      code: CODE,
      accounts,
      roles,
      gateway,
      logger,
    });
    service = new PhoneOtpService({
      gateway,
      rateLimiter: new InMemoryRateLimiter(),
      logger,
      placeholder,
    });
  });

  it("signs a new customer in with the placeholder code and creates their account", async () => {
    const result = await service.verifyCode({ phone: "0991 234 5678", code: CODE });
    expect(result).toEqual({ ok: true, value: { userId: "phone-user-1" } });
    expect(accounts.created).toEqual(["+639912345678"]);
  });

  it("signs a returning customer into the same account", async () => {
    accounts.seed("+639171234567", "existing-customer");
    roles.grants.push({
      userId: "existing-customer",
      grant: { role: "customer", merchantId: null, zoneId: null },
      grantedBy: "system",
    });
    const result = await service.verifyCode({ phone: "09171234567", code: CODE });
    expect(result).toEqual({ ok: true, value: { userId: "existing-customer" } });
    expect(accounts.created).toEqual([]);
  });

  it("is for customers only: a rider's or staff member's number cannot use it", async () => {
    accounts.seed("+639170000021", "rider-1");
    roles.grants.push({
      userId: "rider-1",
      grant: { role: "rider", merchantId: null, zoneId: null },
      grantedBy: "admin",
    });
    const result = await service.verifyCode({ phone: "09170000021", code: CODE });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN");
    expect(logger.lines.some((e) => e.message === "auth.placeholder_refused")).toBe(true);
  });

  it("still checks real codes the normal way, and refuses a wrong one", async () => {
    gateway.validCodes.set("+639171234567", "123456");
    expect((await service.verifyCode({ phone: "09171234567", code: "123456" })).ok).toBe(true);
    const wrong = await service.verifyCode({ phone: "09171234567", code: "000000" });
    expect(!wrong.ok && wrong.error.code).toBe("UNAUTHORIZED");
    expect(accounts.created).toEqual([]);
  });

  it("keeps the wrong-code limit: 10 guesses per phone, placeholder included", async () => {
    for (let i = 0; i < 10; i += 1)
      await service.verifyCode({ phone: "09171234567", code: "111111" });
    const blocked = await service.verifyCode({ phone: "09171234567", code: CODE });
    expect(!blocked.ok && blocked.error.code).toBe("RATE_LIMITED");
  });

  it("lets a customer ask for a code even when no text can be sent", async () => {
    gateway.failSends = true;
    const result = await service.requestCode({ phone: "09171234567", clientIp: "203.0.113.9" });
    expect(result).toEqual({ ok: true, value: { phone: "+639171234567" } });
    expect(logger.lines.some((e) => e.message === "auth.placeholder_sms_skipped")).toBe(true);
  });

  it("without the placeholder, a failed text is reported to the customer", async () => {
    const plain = new PhoneOtpService({ gateway, rateLimiter: new InMemoryRateLimiter(), logger });
    gateway.failSends = true;
    const result = await plain.requestCode({ phone: "09171234567", clientIp: "203.0.113.9" });
    expect(result.ok).toBe(false);
    expect((await plain.verifyCode({ phone: "09171234567", code: CODE })).ok).toBe(false);
  });

  it("refuses a placeholder code that is not 6 digits", () => {
    expect(
      () => new PlaceholderPhoneSignIn({ code: "abc", accounts, roles, gateway, logger }),
    ).toThrow(/6 digits/);
  });

  it("never logs the code or the full phone number", async () => {
    await service.verifyCode({ phone: "09171234567", code: CODE });
    const logged = JSON.stringify(logger.lines);
    expect(logged).not.toContain(CODE);
    expect(logged).not.toContain("9171234567");
  });
});
