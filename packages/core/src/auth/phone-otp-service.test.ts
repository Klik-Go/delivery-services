import { beforeEach, describe, expect, it } from "vitest";
import { FakeAuthGateway, InMemoryRateLimiter, MemoryLogger } from "../testing";
import { PhoneOtpService } from "./phone-otp-service";

describe("PhoneOtpService", () => {
  let gateway: FakeAuthGateway;
  let limiter: InMemoryRateLimiter;
  let service: PhoneOtpService;

  beforeEach(() => {
    gateway = new FakeAuthGateway();
    limiter = new InMemoryRateLimiter();
    service = new PhoneOtpService({ gateway, rateLimiter: limiter, logger: new MemoryLogger() });
  });

  it("normalises the number to +63 and asks Supabase Auth to text a code", async () => {
    const result = await service.requestCode({ phone: "0917 123 4567", clientIp: "203.0.113.5" });
    expect(result).toEqual({ ok: true, value: { phone: "+639171234567" } });
    expect(gateway.otpRequests).toEqual(["+639171234567"]);
  });

  it("refuses a number that is not a Philippine mobile without calling Supabase", async () => {
    const result = await service.requestCode({ phone: "02 8123 4567", clientIp: "203.0.113.5" });
    expect(!result.ok && result.error.code).toBe("VALIDATION_FAILED");
    expect(gateway.otpRequests).toEqual([]);
  });

  it("allows 5 codes per phone per hour, then refuses with a retry time", async () => {
    for (let i = 0; i < 5; i += 1) {
      expect(
        (await service.requestCode({ phone: "09171234567", clientIp: `198.51.100.${i}` })).ok,
      ).toBe(true);
    }
    const sixth = await service.requestCode({ phone: "09171234567", clientIp: "198.51.100.99" });
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) {
      expect(sixth.error.code).toBe("RATE_LIMITED");
      expect("retryAfterSeconds" in sixth.error && sixth.error.retryAfterSeconds).toBeGreaterThan(
        0,
      );
    }
    expect(gateway.otpRequests).toHaveLength(5);
  });

  it("allows 20 codes per network (IP) per hour across different phones", async () => {
    for (let i = 0; i < 20; i += 1) {
      const phone = `0917${String(1_000_000 + i)}`;
      expect((await service.requestCode({ phone, clientIp: "203.0.113.7" })).ok).toBe(true);
    }
    const next = await service.requestCode({ phone: "09179999999", clientIp: "203.0.113.7" });
    expect(!next.ok && next.error.code).toBe("RATE_LIMITED");
  });

  it("signs the person in when the code matches", async () => {
    gateway.validCodes.set("+639171234567", "123456");
    const result = await service.verifyCode({ phone: "09171234567", code: "123456" });
    expect(result.ok && result.value.userId).toBeTruthy();
  });

  it("refuses a wrong or badly formed code", async () => {
    gateway.validCodes.set("+639171234567", "123456");
    const wrong = await service.verifyCode({ phone: "09171234567", code: "000000" });
    expect(!wrong.ok && wrong.error.code).toBe("UNAUTHORIZED");
    const malformed = await service.verifyCode({ phone: "09171234567", code: "12ab" });
    expect(!malformed.ok && malformed.error.code).toBe("VALIDATION_FAILED");
  });

  it("caps code guesses per phone (10 per 15 minutes) to stop brute force", async () => {
    for (let i = 0; i < 10; i += 1)
      await service.verifyCode({ phone: "09171234567", code: "000000" });
    const next = await service.verifyCode({ phone: "09171234567", code: "000000" });
    expect(!next.ok && next.error.code).toBe("RATE_LIMITED");
  });
});
