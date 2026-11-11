import { describe, expect, it } from "vitest";
import {
  AssignRiderSchema,
  DispatchRolloutSchema,
  FeeRuleSchema,
  KycDecisionSchema,
  MerchantCommissionSchema,
  MerchantSlaRolloutSchema,
  RiderApplicationSchema,
  ZoneAreaSchema,
  ZoneUpdateSchema,
} from "./ops";

const ID = "5eed0000-0000-4000-8000-000000000201";
const DISPATCH = {
  offer_seconds: 30,
  max_attempts: 5,
  max_distance_m: 5000,
  start: "accept",
  lead_minutes: 10,
  pin_threshold_centavos: 50000,
  rider_base_centavos: 3500,
  rider_per_km_centavos: 1000,
  rider_free_km: 2,
  avg_speed_kph: 20,
};

describe("ops console inputs", () => {
  it("needs a reason for every change", () => {
    expect(AssignRiderSchema.safeParse({ riderId: ID, reason: "Rider is nearby" }).success).toBe(
      true,
    );
    expect(AssignRiderSchema.safeParse({ riderId: ID, reason: " " }).success).toBe(false);
  });

  it("rejects a document only with a reason", () => {
    expect(KycDecisionSchema.safeParse({ decision: "approve" }).success).toBe(true);
    expect(KycDecisionSchema.safeParse({ decision: "reject" }).success).toBe(false);
  });

  it("checks dispatch settings before they are saved", () => {
    expect(DispatchRolloutSchema.safeParse(DISPATCH).success).toBe(true);
    expect(DispatchRolloutSchema.safeParse({ ...DISPATCH, offer_seconds: 2 }).success).toBe(false);
    expect(DispatchRolloutSchema.safeParse({ ...DISPATCH, surprise: 1 }).success).toBe(false);
  });

  it("keeps the store deadlines in order", () => {
    expect(
      MerchantSlaRolloutSchema.safeParse({
        sms_after_s: 60,
        flag_after_s: 120,
        cancel_after_s: 180,
      }).success,
    ).toBe(true);
    expect(
      MerchantSlaRolloutSchema.safeParse({
        sms_after_s: 120,
        flag_after_s: 60,
        cancel_after_s: 180,
      }).success,
    ).toBe(false);
  });

  it("accepts fee bands that end after they start", () => {
    const band = {
      name: "Up to 2 km",
      kind: "delivery_distance_band",
      minDistanceM: 0,
      maxDistanceM: 2000,
      minSubtotalCentavos: null,
      feeCentavos: 3900,
      priority: 10,
      isActive: true,
    };
    expect(FeeRuleSchema.safeParse(band).success).toBe(true);
    expect(FeeRuleSchema.safeParse({ ...band, maxDistanceM: 0 }).success).toBe(false);
  });

  it("refuses empty zone changes and outlines with too few corners", () => {
    expect(ZoneUpdateSchema.safeParse({}).success).toBe(false);
    expect(ZoneUpdateSchema.safeParse({ baseFeeCentavos: 4500 }).success).toBe(true);
    expect(
      ZoneAreaSchema.safeParse({
        ring: [
          [120, 14],
          [120.1, 14],
        ],
      }).success,
    ).toBe(false);
  });

  it("takes a commission change with its start date", () => {
    expect(
      MerchantCommissionSchema.safeParse({
        commissionBps: 1500,
        effectiveFrom: "2026-11-15T00:00:00+08:00",
        reason: "Promo partner",
      }).success,
    ).toBe(true);
    expect(
      MerchantCommissionSchema.safeParse({ commissionBps: 9000, effectiveFrom: "x", reason: "abc" })
        .success,
    ).toBe(false);
  });

  it("normalises a rider application's plate", () => {
    const parsed = RiderApplicationSchema.parse({
      zoneId: ID,
      vehicleType: "motorcycle",
      plateNo: "nab 1234",
      fullName: "Ella Rider",
      payoutAccountName: "Ella Rider",
    });
    expect(parsed.plateNo).toBe("NAB 1234");
  });
});
