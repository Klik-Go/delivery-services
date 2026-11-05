import { describe, expect, it } from "vitest";
import { FakeClock } from "../testing/fake-clock";
import { HealthService } from "./health-service";

describe("HealthService", () => {
  it("reports the platform as ok with the running version and check time", () => {
    // Arrange
    const clock = new FakeClock(new Date("2026-11-04T00:00:00.000Z"));
    const service = new HealthService({ clock, version: "0.1.0+abc123" });

    // Act
    const result = service.check();

    // Assert
    expect(result).toEqual({
      ok: true,
      value: { status: "ok", version: "0.1.0+abc123", checkedAt: "2026-11-04T00:00:00.000Z" },
    });
  });

  it("uses the clock port rather than the system time", () => {
    const clock = new FakeClock(new Date("2026-01-01T00:00:00.000Z"));
    const service = new HealthService({ clock, version: "dev" });
    clock.advanceBy(90_000);
    const result = service.check();
    expect(result.ok && result.value.checkedAt).toBe("2026-01-01T00:01:30.000Z");
  });
});
