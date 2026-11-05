import { describe, expect, it } from "vitest";
import { NotFoundError } from "./errors";
import { err, isErr, isOk, ok, unwrap } from "./result";

describe("Result", () => {
  it("wraps a success value so callers must check before reading it", () => {
    const result = ok(42);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
    expect(unwrap(result)).toBe(42);
  });

  it("wraps a failure without throwing", () => {
    const result = err(new NotFoundError("Merchant", "m-1"));
    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);
    if (isErr(result)) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("throws the contained error when unwrapping a failure", () => {
    const failure = new NotFoundError("Order", "o-9");
    expect(() => unwrap(err(failure))).toThrow(failure);
  });

  it("wraps a non-Error failure so unwrap always throws an Error", () => {
    expect(() => unwrap(err("sold out"))).toThrow("Unwrapped a failed Result");
  });
});
