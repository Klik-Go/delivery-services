import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import fil from "../../messages/fil.json";
import { DEFAULT_LOCALE, LOCALES, resolveLocale } from "./config";

function keysOf(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keysOf(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("translations", () => {
  it("supports English and Filipino with English as the default", () => {
    expect(LOCALES).toEqual(["en", "fil"]);
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("has the same message keys in Filipino as in English", () => {
    expect(keysOf(fil).sort()).toEqual(keysOf(en).sort());
  });

  it("falls back to English for unknown or missing locale cookies", () => {
    expect(resolveLocale("fil")).toBe("fil");
    expect(resolveLocale("ja")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
  });
});
