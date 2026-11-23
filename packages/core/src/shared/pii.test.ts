import { describe, expect, it } from "vitest";
import { REDACTED, isSensitiveKey, scrubPii, scrubText } from "./pii";

describe("scrubbing personal data", () => {
  it("removes Philippine mobile numbers in every common format", () => {
    for (const phone of [
      "09171234567",
      "+639171234567",
      "0917 123 4567",
      "+63 917-123-4567",
      "639171234567",
    ]) {
      expect(scrubText(`call ${phone} now`), phone).toBe(`call ${REDACTED} now`);
    }
  });

  it("removes emails, long numbers and bearer tokens but keeps ordinary words and short numbers", () => {
    expect(scrubText("mail ana.cruz@example.ph about order KG-1234 (3 items)")).toBe(
      `mail ${REDACTED} about order KG-1234 (3 items)`,
    );
    expect(scrubText("BPI 0012-3456-78 card 4111 1111 1111 1111")).toBe(
      `BPI ${REDACTED} card ${REDACTED}`,
    );
    expect(scrubText("Authorization: Bearer eyJhbGciOi.abc")).toBe(
      `Authorization: Bearer ${REDACTED}`,
    );
  });

  it("replaces personal fields whole, in nested objects and arrays", () => {
    const scrubbed = scrubPii({
      route: "/api/orders",
      status: 500,
      user: { id: "u-1", phone: "+639171234567", fullName: "Ana Cruz" },
      address_snapshot: { street: "12 Mabini St", barangay: "Poblacion" },
      lines: [{ itemId: "i-1", notes: "no onions, ring 0917 000 1111" }],
      message: "Order for ana@example.ph failed",
    });
    expect(scrubbed).toEqual({
      route: "/api/orders",
      status: 500,
      user: { id: "u-1", phone: REDACTED, fullName: REDACTED },
      address_snapshot: REDACTED,
      lines: [{ itemId: "i-1", notes: REDACTED }],
      message: `Order for ${REDACTED} failed`,
    });
  });

  it("recognises sensitive field names in snake, kebab and camel case", () => {
    for (const key of [
      "phone",
      "contact_phone",
      "x-phone",
      "accountNumber",
      "dropoff",
      "otp_code",
      "cookie",
    ]) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
    for (const key of [
      "status",
      "route",
      "orderId",
      "merchant_id",
      "requestId",
      "total_centavos",
    ]) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
  });

  it("stops at a safe depth and passes numbers, booleans and null through", () => {
    let deep: unknown = "end";
    for (let i = 0; i < 10; i += 1) deep = { inner: deep };
    expect(JSON.stringify(scrubPii(deep))).toContain(REDACTED);
    expect(scrubPii({ a: 1, b: true, c: null })).toEqual({ a: 1, b: true, c: null });
  });
});
