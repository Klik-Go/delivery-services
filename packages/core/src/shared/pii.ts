/**
 * Removes personal data from anything that leaves Klik Go for an error tracker or analytics
 * (RA 10173; CLAUDE.md "never log personal data"). Keys that name personal fields are replaced
 * whole; free text keeps its words but loses phone numbers, email addresses and long digit runs
 * (card, account and ID numbers). Over-redacting is fine; leaking is not.
 */
export const REDACTED = "[redacted]";

/** Field names whose values are always personal or secret, whatever they hold. */
const SENSITIVE_KEY =
  /(^|_|-)(phone|mobile|msisdn|email|e_?mail|name|full_?name|first_?name|last_?name|address|street|landmark|barangay|notes?|contact|password|passcode|secret|token|otp|code|pin|cookie|authorization|auth|session|account_?(number|name)|card|cvc|ip|lat|lng|latitude|longitude|location|dropoff|comment|message_?body)($|_|-)/i;
const SENSITIVE_CAMEL =
  /(phone|mobile|email|fullName|firstName|lastName|address|street|landmark|password|secret|token|otp|cookie|authorization|accountNumber|accountName|latitude|longitude|dropoff)/i;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** +63 917 123 4567, 0917-123-4567, 639171234567 and other spaced or dashed forms. */
const PH_MOBILE = /(?:\+?63|0)[\s-]?9\d{2}[\s-]?\d{3}[\s-]?\d{4}/g;
/** Any other run of 7 or more digits (possibly spaced or dashed): accounts, cards, IDs. */
const LONG_DIGITS = /\d(?:[\s-]?\d){6,}/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const MAX_DEPTH = 6;
const MAX_STRING = 2_000;

/** A string with phone numbers, emails, long digit runs and bearer tokens replaced. */
export function scrubText(text: string): string {
  return text
    .slice(0, MAX_STRING)
    .replace(BEARER, `$1 ${REDACTED}`)
    .replace(EMAIL, REDACTED)
    .replace(PH_MOBILE, REDACTED)
    .replace(LONG_DIGITS, REDACTED);
}

/** Whether a field name marks its value as personal or secret. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) || SENSITIVE_CAMEL.test(key);
}

/** A deep copy of `value` with sensitive fields replaced and free text scrubbed. */
export function scrubPii(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => scrubPii(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? REDACTED : scrubPii(inner, depth + 1);
  }
  return out;
}
