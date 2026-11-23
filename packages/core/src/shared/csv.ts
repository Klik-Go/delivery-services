/** Byte-order mark: tells spreadsheets the file is UTF-8 (so ₱ and ñ survive). */
const BOM = String.fromCharCode(0xfeff);

/** One spreadsheet cell: text, a whole number, a peso amount (from centavos), or empty. */
export type CsvCell = string | number | { readonly centavos: number } | null;

/** Centavos as a plain peso amount ("1234.50", "-10.00"), never through a float. */
export function csvPesos(centavos: number): string {
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  return `${sign}${String(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Builds a CSV that opens cleanly in Google Sheets and Excel: UTF-8 with a byte-order mark (so ₱
 * and ñ survive), CRLF line ends, text quoted, numbers and peso amounts left bare so they stay
 * numbers, and text that starts with = + - @ or a tab prefixed with an apostrophe so it is never
 * run as a formula (CSV injection).
 */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const cell = (value: CsvCell): string => {
    if (value === null) return "";
    if (typeof value === "number") return String(value);
    if (typeof value === "object") return csvPesos(value.centavos);
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = [header, ...rows].map((row) => row.map(cell).join(","));
  return `${BOM}${lines.join("\r\n")}\r\n`;
}
