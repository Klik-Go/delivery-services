import { parsePhoneNumberFromString } from "libphonenumber-js";
import { ValidationError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

const PHONE_HINT = "Enter a Philippine mobile number (09XX XXX XXXX).";

/**
 * Normalises a Philippine mobile number to E.164 (+639XXXXXXXXX). Accepts the ways people type
 * it: 0917…, +63 917…, 63917…, 917…, with spaces or dashes. Landlines and foreign numbers are
 * refused because OTP codes go by SMS.
 */
export function normalizePhilippineMobile(input: string): Result<string, ValidationError> {
  const digits = input.replace(/[\s-]/g, "");
  const candidate = /^9\d{9}$/.test(digits) ? `0${digits}` : digits;
  const parsed = parsePhoneNumberFromString(candidate, "PH");
  const national = parsed?.nationalNumber ?? "";
  if (!parsed || parsed.country !== "PH" || !/^9\d{9}$/.test(national) || !parsed.isValid()) {
    return err(new ValidationError(PHONE_HINT, [{ path: "phone", message: PHONE_HINT }]));
  }
  return ok(`+63${national}`);
}
