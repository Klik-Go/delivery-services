import { describe, expect, it } from "vitest";
import { MANILA_TIME_ZONE, formatManilaDateTime, manilaDate } from "./time";

describe("Asia/Manila display time", () => {
  it("shows a UTC instant in Manila time (UTC+8, no DST)", () => {
    const utc = new Date("2026-11-04T16:30:00.000Z");
    expect(formatManilaDateTime(utc)).toBe("Nov 5, 2026, 12:30 AM");
  });

  it("names the zone used for display", () => {
    expect(MANILA_TIME_ZONE).toBe("Asia/Manila");
  });

  it("gives the Manila calendar date, which runs 8 hours ahead of UTC", () => {
    expect(manilaDate(new Date("2026-12-24T15:59:00Z"))).toBe("2026-12-24");
    expect(manilaDate(new Date("2026-12-24T16:00:00Z"))).toBe("2026-12-25");
  });
});
