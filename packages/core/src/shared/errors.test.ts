import { describe, expect, it } from "vitest";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  isAppError,
} from "./errors";

describe("domain errors", () => {
  it("describes a missing resource with a stable code", () => {
    const error = new NotFoundError("Merchant", "m-1");
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("Merchant m-1 was not found");
    expect(error.name).toBe("NotFoundError");
  });

  it("keeps field-level issues on validation errors", () => {
    const error = new ValidationError("Invalid order", [{ path: "items", message: "Required" }]);
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.issues).toEqual([{ path: "items", message: "Required" }]);
  });

  it.each([
    [new ConflictError("Already accepted"), "CONFLICT"],
    [new ForbiddenError(), "FORBIDDEN"],
    [new UnauthorizedError(), "UNAUTHORIZED"],
  ] as const)("gives %s the code %s", (error, code) => {
    expect(error.code).toBe(code);
    expect(isAppError(error)).toBe(true);
  });

  it("does not treat plain errors as domain errors", () => {
    expect(isAppError(new Error("boom"))).toBe(false);
    expect(isAppError("boom")).toBe(false);
  });
});
