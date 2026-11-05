import { describe, expect, it } from "vitest";
import { MemoryLogger } from "./memory-logger";

describe("MemoryLogger", () => {
  it("records every level with child bindings merged in", () => {
    const logger = new MemoryLogger();
    const child = logger.child({ requestId: "r-1" });
    child.debug("d");
    child.info("i", { a: 1 });
    child.warn("w");
    logger.error("e");
    expect(logger.lines).toEqual([
      { level: "debug", message: "d", context: { requestId: "r-1" } },
      { level: "info", message: "i", context: { requestId: "r-1", a: 1 } },
      { level: "warn", message: "w", context: { requestId: "r-1" } },
      { level: "error", message: "e", context: {} },
    ]);
  });
});
