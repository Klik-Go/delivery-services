import { describe, expect, it } from "vitest";
import { normalizePhilippineMobile } from "./phone";

describe("normalizePhilippineMobile", () => {
  it.each([
    ["09171234567", "+639171234567"],
    ["0917 123 4567", "+639171234567"],
    ["0917-123-4567", "+639171234567"],
    ["+63 917 123 4567", "+639171234567"],
    ["639171234567", "+639171234567"],
    ["9171234567", "+639171234567"],
  ])("turns %s into %s", (input, expected) => {
    expect(normalizePhilippineMobile(input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ["02 8123 4567", "a Manila landline"],
    ["+1 415 555 0100", "a US number"],
    ["0917123", "too short"],
    ["hello", "not a number"],
    ["", "empty"],
  ])("refuses %s (%s) with a validation error", (input) => {
    const result = normalizePhilippineMobile(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_FAILED");
      expect(result.error.issues).toEqual([
        { path: "phone", message: "Enter a Philippine mobile number (09XX XXX XXXX)." },
      ]);
    }
  });
});
