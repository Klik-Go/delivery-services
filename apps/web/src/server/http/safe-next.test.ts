import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it("keeps same-site paths with their query", () => {
    expect(safeNextPath("/merchant")).toBe("/merchant");
    expect(safeNextPath("/rider?tab=jobs")).toBe("/rider?tab=jobs");
  });

  it.each([
    "https://evil.example/",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "",
    null,
    undefined,
  ])("refuses %s and falls back", (candidate) => {
    expect(safeNextPath(candidate, "/home")).toBe("/home");
  });
});
