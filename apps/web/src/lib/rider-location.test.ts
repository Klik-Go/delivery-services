import { describe, expect, it } from "vitest";
import { googleMapsLink, metresBetween, secondsLeft, shouldSend, wazeLink } from "./rider-location";

const at = (lat: number, lng: number, seconds: number) => ({ lat, lng, at: seconds * 1000 });

describe("rider location sharing", () => {
  it("sends the first fix straight away", () => {
    expect(shouldSend(null, at(14.55, 121.02, 0))).toBe(true);
  });

  it("sends at most every 7 seconds, and only after a real move", () => {
    const first = at(14.55, 121.02, 0);
    expect(shouldSend(first, at(14.5504, 121.02, 3))).toBe(false);
    expect(shouldSend(first, at(14.5504, 121.02, 8))).toBe(true);
    expect(shouldSend(first, at(14.55001, 121.02, 20))).toBe(false);
  });

  it("checks in every minute while standing still", () => {
    expect(shouldSend(at(14.55, 121.02, 0), at(14.55, 121.02, 61))).toBe(true);
  });

  it("measures short distances in metres", () => {
    expect(metresBetween({ lat: 14.55, lng: 121.02 }, { lat: 14.551, lng: 121.02 })).toBeCloseTo(
      111,
      0,
    );
  });
});

describe("navigation links and countdown", () => {
  it("opens Waze and Google Maps at the destination", () => {
    expect(wazeLink({ lat: 14.5583, lng: 121.0187 })).toBe(
      "https://waze.com/ul?ll=14.558300,121.018700&navigate=yes",
    );
    expect(googleMapsLink({ lat: 14.5583, lng: 121.0187 })).toContain(
      "destination=14.558300,121.018700",
    );
  });

  it("counts the offer down to zero", () => {
    expect(secondsLeft("2026-11-13T04:00:30.000Z", Date.parse("2026-11-13T04:00:00.500Z"))).toBe(
      30,
    );
    expect(secondsLeft("2026-11-13T04:00:30.000Z", Date.parse("2026-11-13T04:01:00Z"))).toBe(0);
  });
});
