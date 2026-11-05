import { describe, expect, it } from "vitest";
import { assuranceLevelOf } from "./access-token";

function tokenWith(claims: object): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part(claims)}.signature`;
}

describe("assuranceLevelOf", () => {
  it("reads aal2 from a token issued after the second factor", () => {
    expect(assuranceLevelOf(tokenWith({ sub: "u1", aal: "aal2" }))).toBe("aal2");
  });

  it("treats a password- or OTP-only token as aal1", () => {
    expect(assuranceLevelOf(tokenWith({ sub: "u1", aal: "aal1" }))).toBe("aal1");
    expect(assuranceLevelOf(tokenWith({ sub: "u1" }))).toBe("aal1");
  });

  it("never grants aal2 for a malformed token", () => {
    expect(assuranceLevelOf("not-a-token")).toBe("aal1");
    expect(assuranceLevelOf("a.%%%.c")).toBe("aal1");
  });
});
