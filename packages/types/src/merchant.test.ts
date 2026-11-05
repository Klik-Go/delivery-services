import { describe, expect, it } from "vitest";
import {
  MerchantApplicationSchema,
  StoreClosureSchema,
  StoreSettingsSchema,
  WeeklyHoursSchema,
} from "./merchant";

const application = {
  businessName: "Lugaw ni Mang Ben",
  ownerName: "Ben Santos",
  phone: "0917 123 4567",
  email: "ben@example.test",
  category: "food",
  barangay: "Poblacion",
  city: "Placeholder City",
  location: { lat: 14.6, lng: 120.98 },
};

describe("merchant schemas", () => {
  it("accepts a complete partner application and trims its text", () => {
    const parsed = MerchantApplicationSchema.parse({ ...application, businessName: "  Lugaw  " });
    expect(parsed.businessName).toBe("Lugaw");
  });

  it("refuses an application without a valid email or map pin", () => {
    expect(MerchantApplicationSchema.safeParse({ ...application, email: "ben" }).success).toBe(
      false,
    );
    expect(
      MerchantApplicationSchema.safeParse({ ...application, location: { lat: 99, lng: 0 } })
        .success,
    ).toBe(false);
  });

  it("treats an empty day as closed and allows a lunch and a dinner window", () => {
    const week = WeeklyHoursSchema.parse({
      mon: [
        { open: "10:00", close: "14:00" },
        { open: "17:00", close: "21:00" },
      ],
    });
    expect(week.mon).toHaveLength(2);
    expect(week.sun).toEqual([]);
  });

  it("refuses a window that closes before it opens, or overlapping windows", () => {
    expect(WeeklyHoursSchema.safeParse({ mon: [{ open: "14:00", close: "10:00" }] }).success).toBe(
      false,
    );
    expect(
      WeeklyHoursSchema.safeParse({
        mon: [
          { open: "10:00", close: "15:00" },
          { open: "14:00", close: "21:00" },
        ],
      }).success,
    ).toBe(false);
    expect(WeeklyHoursSchema.safeParse({ mon: [{ open: "25:00", close: "26:00" }] }).success).toBe(
      false,
    );
  });

  it("allows a service radius with one decimal, or none (the zone maximum)", () => {
    const base = { hours: {}, defaultPrepMinutes: 15, acceptsCod: true };
    expect(StoreSettingsSchema.safeParse({ ...base, serviceRadiusKm: 2.5 }).success).toBe(true);
    expect(StoreSettingsSchema.safeParse({ ...base, serviceRadiusKm: null }).success).toBe(true);
    expect(StoreSettingsSchema.safeParse({ ...base, serviceRadiusKm: 2.55 }).success).toBe(false);
  });

  it("takes holiday closures as calendar dates", () => {
    expect(StoreClosureSchema.safeParse({ closedOn: "2026-12-25" }).success).toBe(true);
    expect(StoreClosureSchema.safeParse({ closedOn: "25/12/2026" }).success).toBe(false);
  });
});
