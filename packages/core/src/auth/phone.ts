import { ValidationError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

const PHONE_HINT = "Enter a Philippine mobile number (09XX XXX XXXX).";

/**
 * A Philippine mobile number is 10 digits after the trunk 0, starting with 9 (0917, 0991, …) or
 * 8 (0817, DITO's 0895–0898). Landlines have 9 digits (02 8XXX XXXX), so they never match.
 * Any prefix in that range is accepted: phone-number libraries lag behind newly assigned
 * prefixes, and refusing a real customer costs more than one undeliverable SMS.
 */
const MOBILE = /^(?:\+?63|0)?([89]\d{9})$/;

/**
 * Normalises a Philippine mobile number to E.164 (+63XXXXXXXXXX). Accepts the ways people type
 * it: 0917…, +63 917…, 63917…, 917…, with spaces, dashes, dots or brackets. Landlines and
 * foreign numbers are refused because OTP codes go by SMS.
 */
export function normalizePhilippineMobile(input: string): Result<string, ValidationError> {
  const compact = input.replace(/[\s().-]/g, "");
  const national = MOBILE.exec(compact)?.[1];
  if (!national) {
    return err(new ValidationError(PHONE_HINT, [{ path: "phone", message: PHONE_HINT }]));
  }
  return ok(`+63${national}`);
}
