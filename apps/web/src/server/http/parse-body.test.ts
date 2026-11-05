import { OtpVerifySchema } from "@klikgo/types";
import { describe, expect, it } from "vitest";
import { parseBody } from "./parse-body";

const post = (body: string) => new Request("http://localhost/api/x", { method: "POST", body });

describe("parseBody", () => {
  it("returns the validated body", async () => {
    expect(
      await parseBody(post(JSON.stringify({ phone: "0917", code: "123456" })), OtpVerifySchema),
    ).toEqual({
      ok: true,
      value: { phone: "0917", code: "123456" },
    });
  });

  it("explains field problems and rejects non-JSON", async () => {
    const bad = await parseBody(
      post(JSON.stringify({ phone: "0917", code: "12" })),
      OtpVerifySchema,
    );
    expect(!bad.ok && bad.error.issues).toEqual([
      { path: "code", message: "Enter the 6-digit code." },
    ]);
    const notJson = await parseBody(post("not json"), OtpVerifySchema);
    expect(!notJson.ok && notJson.error.message).toBe("The request body must be JSON.");
  });
});
