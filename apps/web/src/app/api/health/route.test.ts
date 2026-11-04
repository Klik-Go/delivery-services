import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/health", () => {
  it("answers ok in the standard envelope with the caller's request id", async () => {
    const request = new Request("http://localhost/api/health", {
      headers: { "x-request-id": "9b2b9a8e-3c1d-4e5f-8a7b-6c5d4e3f2a1b" },
    });

    const response = GET(request);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: unknown;
      error: unknown;
      meta: Record<string, unknown>;
    };
    expect(body.data).toEqual({ status: "ok" });
    expect(body.error).toBeNull();
    expect(body.meta.requestId).toBe("9b2b9a8e-3c1d-4e5f-8a7b-6c5d4e3f2a1b");
    expect(typeof body.meta.version).toBe("string");
    expect(Number.isNaN(Date.parse(String(body.meta.checkedAt)))).toBe(false);
  });
});
