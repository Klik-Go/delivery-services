import { DeviceIdSchema } from "@klikgo/types";

/**
 * The app's device id (X-Device-Id header): a random id the PWA keeps on the phone, used only
 * for the one-promo and one-referral-per-device guards (the server stores a hash). Missing or
 * malformed ids count as unknown, never as an error.
 */
export function deviceIdOf(request: Request): string | null {
  const parsed = DeviceIdSchema.safeParse(request.headers.get("x-device-id"));
  return parsed.success ? parsed.data : null;
}
