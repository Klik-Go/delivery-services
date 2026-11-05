import { SendSmsHookSchema } from "@klikgo/types";
import { Webhook, WebhookVerificationError } from "standardwebhooks";
import { getContainer } from "@/server/container";
import { getServerEnv } from "@/server/env";

/**
 * POST /api/hooks/send-sms — Supabase Auth "Send SMS" hook (Standard Webhooks signature).
 * Called by Supabase, not browsers. The secret (SEND_SMS_HOOK_SECRET, "v1,whsec_…") is shared
 * with the Supabase project's hook settings. Errors use the hook's {error:{http_code,message}} shape.
 */
export async function POST(request: Request): Promise<Response> {
  const { logger, otpSms } = getContainer();
  const secret = getServerEnv().SEND_SMS_HOOK_SECRET;
  if (!secret) return hookError(500, "SMS hook is not configured.");

  const payload = await request.text();
  let verified: unknown;
  try {
    verified = new Webhook(secret.replace(/^v1,/, "")).verify(
      payload,
      Object.fromEntries(request.headers),
    );
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      logger.warn("hook.send_sms.bad_signature");
      return hookError(401, "Invalid signature.");
    }
    throw error;
  }

  const parsed = SendSmsHookSchema.safeParse(verified);
  if (!parsed.success) return hookError(400, "Unexpected payload.");
  const result = await otpSms.deliver({ phone: parsed.data.user.phone, otp: parsed.data.sms.otp });
  return result.ok ? Response.json({}) : hookError(500, "Could not send the SMS.");
}

function hookError(status: number, message: string): Response {
  return Response.json({ error: { http_code: status, message } }, { status });
}
