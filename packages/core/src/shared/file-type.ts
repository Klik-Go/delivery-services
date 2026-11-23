/** File types Klik Go accepts in uploads, recognised from their first bytes. */
export type SniffedType =
  "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "application/pdf";

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

const ascii = (bytes: Uint8Array, from: number, to: number): string =>
  String.fromCharCode(...bytes.subarray(from, to));

/**
 * What a file really is, from its magic bytes, or null when it is none of the accepted types.
 * The browser's declared type and the file name are just claims; a web page renamed to .jpg is
 * still a web page (OWASP ASVS 12.2.1).
 */
export function sniffFileType(bytes: Uint8Array): SniffedType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP")
    return "image/webp";
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (["heic", "heix", "heim", "heis", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  return null;
}

/**
 * The file's real type when it is one of `allowed` and agrees with the declared type's family
 * (a photo declared as a photo, a PDF as a PDF); null otherwise.
 */
export function verifiedFileType(
  bytes: Uint8Array,
  declared: string,
  allowed: readonly SniffedType[],
): SniffedType | null {
  const actual = sniffFileType(bytes);
  if (!actual || !allowed.includes(actual)) return null;
  const family = (type: string): string =>
    type === "application/pdf" ? "pdf" : (type.split("/")[0] ?? "");
  return family(actual) === family(declared.toLowerCase()) ? actual : null;
}
