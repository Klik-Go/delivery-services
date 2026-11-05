import { describe, expect, it } from "vitest";
import { getPrismaClient } from "./client";

describe("getPrismaClient", () => {
  it("reuses one client per process so hot reloads do not leak connections", () => {
    expect(getPrismaClient()).toBe(getPrismaClient());
  });
});
