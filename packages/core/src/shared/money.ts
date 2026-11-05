/**
 * Money is always an integer number of centavos (₱1 = 100 centavos). Floats are never used for
 * money because 0.1 + 0.2 !== 0.3 and PH receipts must reconcile to the centavo.
 */
export type Centavos = number;

const PESO_FORMAT = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const PESO_INPUT = /^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/;

/** Throws if `value` is not a safe integer number of centavos; returns it otherwise. */
export function assertCentavos(value: number): Centavos {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Money must be a safe integer number of centavos, got ${value}`);
  }
  return value;
}

/** Formats centavos for display, e.g. 123450 → "₱1,234.50". The only peso formatter in the codebase. */
export function formatPeso(centavos: Centavos): string {
  // Integer division keeps the conversion exact for every safe integer.
  return PESO_FORMAT.format(assertCentavos(centavos) / 100);
}

/** Sums centavo amounts, validating each one. */
export function addCentavos(...amounts: Centavos[]): Centavos {
  return assertCentavos(amounts.reduce((total, amount) => total + assertCentavos(amount), 0));
}

/** Parses a peso amount typed by a person ("1,299.95") into centavos without float math. */
export function pesosToCentavos(input: string): Centavos {
  const trimmed = input.trim();
  if (!PESO_INPUT.test(trimmed)) {
    throw new RangeError(`"${input}" is not a peso amount with at most 2 decimal places`);
  }
  const [whole = "0", fraction = ""] = trimmed.replaceAll(",", "").split(".");
  return assertCentavos(Number(whole) * 100 + Number(fraction.padEnd(2, "0")));
}
