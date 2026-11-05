import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@klikgo/core";
import { describe, expect, it } from "vitest";
import { jsonError, jsonOk } from "./api-response";

describe("API response envelope", () => {
  it("wraps data in { data, error: null, meta } and echoes the request id", async () => {
    const response = jsonOk({ status: "ok" }, { requestId: "req-1" });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-1");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      data: { status: "ok" },
      error: null,
      meta: { requestId: "req-1" },
    });
  });

  it.each([
    [new ValidationError("Bad input", [{ path: "phone", message: "Invalid" }]), 400],
    [new UnauthorizedError(), 401],
    [new ForbiddenError(), 403],
    [new NotFoundError("Order", "o-1"), 404],
    [new ConflictError("Already accepted"), 409],
  ])("maps %s to HTTP %i", async (error, status) => {
    const response = jsonError(error, { requestId: "req-2" });
    expect(response.status).toBe(status);
    const body = (await response.json()) as {
      data: unknown;
      error: { code: string; message: string };
    };
    expect(body.data).toBeNull();
    expect(body.error.code).toBe(error.code);
    expect(body.error.message).toBe(error.message);
  });

  it("includes field issues for validation failures", async () => {
    const response = jsonError(
      new ValidationError("Bad input", [{ path: "phone", message: "Invalid" }]),
      {
        requestId: "r",
      },
    );
    const body = (await response.json()) as { error: { issues: unknown } };
    expect(body.error.issues).toEqual([{ path: "phone", message: "Invalid" }]);
  });

  it("hides internal details of unexpected errors", async () => {
    const response = jsonError(new Error("connection string postgres://secret"), {
      requestId: "req-3",
    });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error).toEqual({
      code: "INTERNAL",
      message: "Something went wrong. Please try again.",
    });
  });
});
