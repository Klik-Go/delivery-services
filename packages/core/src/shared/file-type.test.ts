import { describe, expect, it } from "vitest";
import { sniffFileType, verifiedFileType } from "./file-type";

const bytes = (...parts: (number[] | string)[]): Uint8Array =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );

const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ");
const HEIC = bytes([0, 0, 0, 0x18], "ftypheic", [0, 0]);
const PDF = bytes("%PDF-1.7\n");
const HTML = bytes("<!doctype html><script>alert(1)</script>");

describe("recognising uploads from their bytes", () => {
  it("knows JPEG, PNG, WebP, HEIC and PDF", () => {
    expect([JPEG, PNG, WEBP, HEIC, PDF].map(sniffFileType)).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "application/pdf",
    ]);
  });

  it("rejects a web page, an empty file and a truncated header", () => {
    expect(sniffFileType(HTML)).toBeNull();
    expect(sniffFileType(new Uint8Array())).toBeNull();
    expect(sniffFileType(bytes([0xff, 0xd8]))).toBeNull();
    expect(sniffFileType(bytes("RIFF", [0, 0, 0, 0], "AVI "))).toBeNull();
  });

  it("accepts a file only when its bytes are an allowed type in the declared family", () => {
    const photos = ["image/jpeg", "image/png", "image/webp"] as const;
    expect(verifiedFileType(PNG, "image/jpeg", photos)).toBe("image/png");
    expect(verifiedFileType(HTML, "image/jpeg", photos)).toBeNull();
    expect(verifiedFileType(PDF, "image/jpeg", [...photos, "application/pdf"])).toBeNull();
    expect(verifiedFileType(PDF, "application/pdf", ["application/pdf"])).toBe("application/pdf");
    expect(verifiedFileType(HEIC, "image/heic", photos)).toBeNull();
  });
});
