import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins classes and lets later Tailwind utilities win", () => {
    const isHidden = false as boolean;
    expect(cn("px-2 py-1", isHidden && "hidden", "px-4")).toBe("py-1 px-4");
  });
});
