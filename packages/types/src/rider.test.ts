import { describe, expect, it } from "vitest";
import {
  DeliveryPhotoSchema,
  DeliveryProofSchema,
  RiderLocationSchema,
  RiderOnlineSchema,
} from "./rider";

describe("rider schemas", () => {
  it("accepts a GPS fix and refuses impossible coordinates", () => {
    expect(RiderLocationSchema.safeParse({ lat: 14.55, lng: 121.02, heading: 90 }).success).toBe(
      true,
    );
    expect(RiderLocationSchema.safeParse({ lat: 91, lng: 121 }).success).toBe(false);
    expect(RiderLocationSchema.safeParse({ lat: 14.5, lng: 121, speedKph: -1 }).success).toBe(
      false,
    );
  });

  it("takes only a boolean for the online switch", () => {
    expect(RiderOnlineSchema.safeParse({ online: true }).success).toBe(true);
    expect(RiderOnlineSchema.safeParse({ online: "yes" }).success).toBe(false);
  });

  it("takes a 4-digit PIN or none", () => {
    expect(DeliveryProofSchema.parse({ pin: " 4821 " })).toEqual({ pin: "4821" });
    expect(DeliveryProofSchema.parse({})).toEqual({});
    expect(DeliveryProofSchema.safeParse({ pin: "48a1" }).success).toBe(false);
  });

  it("takes photos up to 2 MB in the bucket's formats", () => {
    expect(DeliveryPhotoSchema.safeParse({ type: "image/jpeg", size: 500_000 }).success).toBe(true);
    expect(DeliveryPhotoSchema.safeParse({ type: "image/gif", size: 500 }).success).toBe(false);
    expect(DeliveryPhotoSchema.safeParse({ type: "image/png", size: 3_000_000 }).success).toBe(
      false,
    );
    expect(DeliveryPhotoSchema.safeParse({ type: "image/png", size: 0 }).success).toBe(false);
  });
});
