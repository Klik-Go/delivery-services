import { describe, expect, it } from "vitest";
import { etaRange, haversineMeters, roadMeters } from "./geo";
import { openingStatus } from "./hours";
import { ALL_DAY } from "../testing/catalog-world";

const LUNCH_DINNER = {
  mon: [
    { open: "10:00", close: "14:00" },
    { open: "17:00", close: "21:00" },
  ],
  tue: [{ open: "10:00", close: "14:00" }],
  wed: [],
  thu: [],
  fri: [],
  sat: [],
  sun: [],
};
/** Monday 2026-11-02 at the given Manila time (UTC+8). */
const mondayAt = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00+08:00`);

describe("distance and arrival time", () => {
  it("measures the straight line and adds a road factor", () => {
    const a = { lat: 14.5547, lng: 121.0244 };
    const b = { lat: 14.5583, lng: 121.0187 };
    expect(haversineMeters(a, b)).toBeCloseTo(730, -1);
    expect(roadMeters(a, b)).toBe(Math.round(haversineMeters(a, b) * 1.3));
    expect(haversineMeters(a, a)).toBe(0);
  });

  it("gives a 10-minute arrival window: preparation plus the ride at 20 km/h", () => {
    expect(etaRange(15, 3000)).toEqual({ min: 25, max: 35 });
    expect(etaRange(0, 0)).toEqual({ min: 10, max: 20 });
  });
});

describe("opening hours (Asia/Manila)", () => {
  const store = { isOpen: true, hours: LUNCH_DINNER, closedDates: [] as string[] };

  it("is open inside a window and closed between lunch and dinner", () => {
    expect(openingStatus(store, mondayAt("11:30"))).toEqual({ open: true, opensAt: null });
    expect(openingStatus(store, mondayAt("15:00"))).toEqual({
      open: false,
      opensAt: { day: "today", time: "17:00" },
    });
  });

  it("looks ahead to tomorrow or later in the week", () => {
    expect(openingStatus(store, mondayAt("22:00")).opensAt).toEqual({
      day: "tomorrow",
      time: "10:00",
    });
    const tuesdayNight = new Date("2026-11-03T15:00:00+08:00");
    expect(openingStatus(store, tuesdayNight).opensAt).toEqual({ day: "mon", time: "10:00" });
  });

  it("skips holiday closures and respects the owner's closed toggle", () => {
    expect(
      openingStatus({ ...store, closedDates: ["2026-11-02"] }, mondayAt("11:30")).opensAt,
    ).toEqual({ day: "tomorrow", time: "10:00" });
    expect(openingStatus({ ...store, isOpen: false }, mondayAt("11:30"))).toEqual({
      open: false,
      opensAt: null,
    });
    expect(
      openingStatus(
        {
          isOpen: true,
          hours: { ...ALL_DAY, mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
          closedDates: [],
        },
        mondayAt("11:00"),
      ),
    ).toEqual({ open: false, opensAt: null });
  });
});
