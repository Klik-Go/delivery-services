import { beforeEach, describe, expect, it } from "vitest";
import { FakeAuthGateway, InMemoryRateLimiter } from "../testing";
import { MfaService } from "./mfa-service";

describe("MfaService", () => {
  let gateway: FakeAuthGateway;
  let service: MfaService;

  beforeEach(() => {
    gateway = new FakeAuthGateway();
    service = new MfaService({ gateway, rateLimiter: new InMemoryRateLimiter() });
  });

  it("enrols a new authenticator and raises the session to AAL2 when the first code is right", async () => {
    const enrolment = await service.startEnrollment();
    expect(enrolment.ok && enrolment.value.secret).toBe("JBSWY3DPEHPK3PXP");
    const verified = await service.verify({ userId: "u-1", factorId: "factor-1", code: "123456" });
    expect(verified.ok).toBe(true);
    const status = await service.status();
    expect(status.ok && status.value.aal).toBe("aal2");
  });

  it("does not enrol a second authenticator; it challenges the existing one", async () => {
    gateway.mfa = { aal: "aal1", verifiedFactorId: "factor-9" };
    expect((await service.startEnrollment()).ok).toBe(false);
    expect((await service.verify({ userId: "u-1", factorId: null, code: "123456" })).ok).toBe(true);
    expect(gateway.mfa).toEqual({ aal: "aal2", verifiedFactorId: "factor-9" });
  });

  it("refuses wrong, malformed and missing-factor codes", async () => {
    expect((await service.verify({ userId: "u-1", factorId: "factor-1", code: "000000" })).ok).toBe(
      false,
    );
    const malformed = await service.verify({ userId: "u-1", factorId: "factor-1", code: "12" });
    expect(!malformed.ok && malformed.error.code).toBe("VALIDATION_FAILED");
    const noFactor = await service.verify({ userId: "u-1", factorId: null, code: "123456" });
    expect(!noFactor.ok && noFactor.error.code).toBe("UNAUTHORIZED");
  });

  it("locks TOTP guessing after 10 tries in 15 minutes", async () => {
    for (let i = 0; i < 10; i += 1)
      await service.verify({ userId: "u-1", factorId: "factor-1", code: "000000" });
    const next = await service.verify({ userId: "u-1", factorId: "factor-1", code: "123456" });
    expect(next.ok).toBe(false);
  });
});
