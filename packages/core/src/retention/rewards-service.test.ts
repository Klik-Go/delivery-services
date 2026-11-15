import { describe, expect, it } from "vitest";
import { FakeClock } from "../testing/fake-clock";
import { MemoryLogger } from "../testing/memory-logger";
import { FakeContentHasher } from "../testing/ordering-fakes";
import { InMemoryRewards } from "../testing/retention-fakes";
import { sessionUser } from "../testing/session-users";
import { RewardsService, STAMPS_PER_REWARD } from "./rewards-service";

function setup() {
  const rewards = new InMemoryRewards();
  const clock = new FakeClock(new Date("2026-11-15T04:00:00Z"));
  const service = new RewardsService({
    rewards,
    hasher: new FakeContentHasher(),
    clock,
    logger: new MemoryLogger(),
  });
  const carmen = sessionUser("carmen", [{ role: "customer" }], "aal1");
  const liza = sessionUser("liza", [{ role: "customer" }], "aal1");
  return { rewards, service, carmen, liza };
}

describe("RewardsService: referral codes", () => {
  it("gives every customer one code and shows the reward, stamps and vouchers", async () => {
    const { service, carmen } = setup();
    const first = await service.summary(carmen);
    const again = await service.summary(carmen);
    expect(first.ok && first.value).toMatchObject({
      rewardCentavos: 5000,
      referredBy: null,
      canEnterCode: true,
      friends: { pending: 0, rewarded: 0 },
      stamps: { count: 0, goal: 10, minSubtotalCentavos: 15000 },
      vouchers: [],
    });
    expect(again.ok && again.value.referralCode).toBe(first.ok && first.value.referralCode);
    expect((await service.summary(null)).ok).toBe(false);
  });

  it("lets a new customer enter a friend's code once", async () => {
    const { service, carmen, liza, rewards } = setup();
    const code = await rewards.referralCode("carmen");
    expect(await service.enterReferralCode(liza, code, "liza-phone-device-1")).toEqual({
      ok: true,
      value: { status: "pending" },
    });
    const twice = await service.enterReferralCode(liza, code, "liza-phone-device-1");
    expect(!twice.ok && twice.error.message).toBe("You have already entered a friend's code.");
    const summary = await service.summary(liza);
    expect(summary.ok && summary.value).toMatchObject({
      referredBy: { status: "pending" },
      canEnterCode: false,
    });
    const carmens = await service.summary(carmen);
    expect(carmens.ok && carmens.value.friends.pending).toBe(1);
  });

  it("refuses unknown codes, your own code, existing customers and a second claim on one phone", async () => {
    const { service, carmen, liza, rewards } = setup();
    const code = await rewards.referralCode("carmen");
    const message = async (
      user = liza,
      typed = code,
      device: string | null = "d-1234567890abcdef",
    ) => {
      const result = await service.enterReferralCode(user, typed, device);
      return result.ok ? "ok" : result.error.message;
    };
    expect(await message(liza, "NOPE1234")).toBe("We couldn't find that referral code.");
    expect(await message(carmen)).toBe("That's your own code. Share it with a friend.");
    rewards.orderCounts.set("liza", 1);
    expect(await message()).toBe("Referral codes are for your first order only.");
    rewards.orderCounts.set("liza", 0);
    expect(await message()).toBe("ok");
    const tess = sessionUser("tess", [{ role: "customer" }], "aal1");
    expect(await message(tess)).toBe("A referral code was already used on this phone.");
    expect((await service.enterReferralCode(null, code, null)).ok).toBe(false);
  });
});

describe("RewardsService: delivered orders", () => {
  it("stamps orders of ₱150 or more and turns every 10th stamp into a free-delivery voucher", async () => {
    const { service, rewards, carmen } = setup();
    rewards.due.push({ orderId: "small", customerId: "carmen", subtotalCentavos: 14900 });
    for (let i = 0; i < STAMPS_PER_REWARD; i += 1) {
      rewards.due.push({
        orderId: `o-${String(i)}`,
        customerId: "carmen",
        subtotalCentavos: 20000,
      });
    }
    const run = await service.processDelivered(100);
    expect(run).toEqual({
      processed: 11,
      stamps: 10,
      loyaltyVouchers: 0,
      referralsRewarded: 0,
      referralsVoided: 0,
    });
    // Stamps are counted one order at a time: the 10th arrives in a later run.
    expect(rewards.stamps).toHaveLength(10);
    rewards.due.push({ orderId: "o-11", customerId: "carmen", subtotalCentavos: 20000 });
    const next = await service.processDelivered();
    expect(next.loyaltyVouchers).toBe(1);
    const summary = await service.summary(carmen);
    expect(summary.ok && summary.value.stamps.count).toBe(1);
    expect(summary.ok && summary.value.vouchers).toMatchObject([
      { type: "free_delivery", source: "loyalty", used: false },
    ]);
  });

  it("rewards both friends with ₱50 after the friend's first delivery, once", async () => {
    const { service, rewards, carmen, liza } = setup();
    await service.enterReferralCode(liza, await rewards.referralCode("carmen"), null);
    rewards.due.push({ orderId: "liza-1", customerId: "liza", subtotalCentavos: 20000 });
    expect((await service.processDelivered()).referralsRewarded).toBe(1);
    expect(await service.processDelivered()).toMatchObject({ processed: 0 });
    for (const user of [carmen, liza]) {
      const summary = await service.summary(user);
      expect(summary.ok && summary.value.vouchers).toMatchObject([
        { type: "fixed_off", source: "referral", discountCentavos: 5000 },
      ]);
    }
    const summary = await service.summary(carmen);
    expect(summary.ok && summary.value.friends.rewarded).toBe(1);
  });

  it("voids a referral whose first order went to the referrer's own address", async () => {
    const { service, rewards, carmen, liza } = setup();
    await service.enterReferralCode(liza, await rewards.referralCode("carmen"), null);
    rewards.due.push({
      orderId: "liza-1",
      customerId: "liza",
      subtotalCentavos: 20000,
      sameAddress: true,
    });
    expect((await service.processDelivered()).referralsVoided).toBe(1);
    expect(rewards.referrals[0]).toMatchObject({
      status: "void",
      voidReason: "First order went to the referrer's own address",
    });
    const summary = await service.summary(carmen);
    expect(summary.ok && summary.value.vouchers).toEqual([]);
  });
});
