import { randomBytes, randomUUID } from "node:crypto";
import { Webhook } from "standardwebhooks";
import { beforeAll, describe, expect, it, vi } from "vitest";

// A throwaway secret for this test only (format used by Supabase: "v1,whsec_<base64>").
const SECRET = `v1,whsec_${randomBytes(32).toString("base64")}`;

let POST: (request: Request) => Promise<Response>;

beforeAll(async () => {
  vi.stubEnv("SEND_SMS_HOOK_SECRET", SECRET);
  vi.stubEnv("SEMAPHORE_API_KEY", "");
  ({ POST } = await import("./route"));
});

function signed(payload: unknown, secret = SECRET): Request {
  const body = JSON.stringify(payload);
  const id = `msg_${randomUUID()}`;
  const timestamp = new Date();
  const signature = new Webhook(secret.replace(/^v1,/, "")).sign(id, timestamp, body);
  return new Request("http://localhost/api/hooks/send-sms", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "webhook-signature": signature,
    },
  });
}

describe("POST /api/hooks/send-sms (Supabase Send SMS hook)", () => {
  it("accepts a correctly signed request and sends the code", async () => {
    const response = await POST(
      signed({ user: { phone: "639171234567" }, sms: { otp: "482913" } }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });

  it("rejects a request signed with another secret", async () => {
    const other = `v1,whsec_${randomBytes(32).toString("base64")}`;
    const response = await POST(
      signed({ user: { phone: "639171234567" }, sms: { otp: "482913" } }, other),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { http_code: 401, message: "Invalid signature." },
    });
  });

  it("rejects an unsigned request", async () => {
    const response = await POST(
      new Request("http://localhost/api/hooks/send-sms", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a signed payload that is not an SMS hook", async () => {
    const response = await POST(signed({ hello: "world" }));
    expect(response.status).toBe(400);
  });
});
