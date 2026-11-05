import { beforeEach, describe, expect, it } from "vitest";
import {
  FakeAuthGateway,
  InMemoryInviteRepository,
  InMemoryRateLimiter,
  MemoryLogger,
} from "../testing";
import { StaffAuthService } from "./staff-auth-service";

describe("StaffAuthService", () => {
  let gateway: FakeAuthGateway;
  let invites: InMemoryInviteRepository;
  let service: StaffAuthService;

  beforeEach(() => {
    gateway = new FakeAuthGateway();
    invites = new InMemoryInviteRepository();
    service = new StaffAuthService({
      gateway,
      invites,
      rateLimiter: new InMemoryRateLimiter(),
      logger: new MemoryLogger(),
    });
  });

  it("signs staff in with email and password, then always continues to the second factor", async () => {
    gateway.passwords.set("owner@example.test", "correct horse battery");
    const result = await service.signIn({
      email: "Owner@Example.test ",
      password: "correct horse battery",
      clientIp: "203.0.113.1",
    });
    expect(result).toEqual({ ok: true, value: { next: "/auth/mfa" } });
  });

  it("gives one vague message for a wrong email or password", async () => {
    gateway.passwords.set("owner@example.test", "correct horse battery");
    const result = await service.signIn({
      email: "owner@example.test",
      password: "wrong",
      clientIp: "203.0.113.1",
    });
    expect(!result.ok && result.error.code).toBe("UNAUTHORIZED");
    expect(!result.ok && result.error.message).toBe("Wrong email or password.");
  });

  it("slows password guessing: 10 tries per email per 15 minutes", async () => {
    for (let i = 0; i < 10; i += 1) {
      await service.signIn({
        email: "owner@example.test",
        password: `guess-${i}`,
        clientIp: `198.51.100.${i}`,
      });
    }
    const next = await service.signIn({
      email: "owner@example.test",
      password: "guess",
      clientIp: "198.51.100.200",
    });
    expect(!next.ok && next.error.code).toBe("RATE_LIMITED");
  });

  it("requires a password of at least 12 characters when setting it", async () => {
    const short = await service.setPassword({ userId: "u-1", password: "short pw" });
    expect(!short.ok && short.error.code).toBe("VALIDATION_FAILED");
    const blank = await service.setPassword({ userId: "u-1", password: "            " });
    expect(!blank.ok && blank.error.code).toBe("VALIDATION_FAILED");
  });

  it("sets the password, marks the invite accepted and continues to TOTP enrolment", async () => {
    const result = await service.setPassword({
      userId: "u-1",
      password: "a long and memorable phrase",
    });
    expect(result).toEqual({ ok: true, value: { next: "/auth/mfa" } });
    expect(gateway.passwordUpdates).toEqual(["a long and memorable phrase"]);
    expect(invites.accepted).toEqual(["u-1"]);
  });
});
