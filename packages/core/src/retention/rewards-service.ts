import type { SessionUser } from "../auth/session-user";
import type { IContentHasher } from "../ordering/ports";
import { identityHashes } from "../ordering/order-service";
import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import { ConflictError, UnauthorizedError, ValidationError, type AppError } from "../shared/errors";
import type { Centavos } from "../shared/money";
import { err, ok, type Result } from "../shared/result";
import type {
  IRewardsRepository,
  ReferralStatus,
  RewardFacts,
  RewardPlan,
  VoucherSpec,
  VoucherView,
} from "./ports";

/** ₱50 for the customer who shared the code and ₱50 for the friend (docs/BUSINESS.md §4.2). */
export const REFERRAL_REWARD_CENTAVOS = 5000;
/** Every 10th stamp earns a free delivery (docs/BUSINESS.md §4.2, §9.2.1). */
export const STAMPS_PER_REWARD = 10;
/** Orders below this (before fees) earn no stamp, so tiny orders cannot farm stamps. */
export const STAMP_MIN_SUBTOTAL_CENTAVOS = 15_000;
/** Reward vouchers last 90 days. */
export const VOUCHER_DAYS = 90;

/** What the Rewards page shows. */
export interface RewardsSummary {
  readonly referralCode: string;
  readonly rewardCentavos: Centavos;
  /** The friend's code this customer entered, and how it stands; null if none. */
  readonly referredBy: { readonly status: ReferralStatus } | null;
  /** True while the customer can still enter a friend's code (no orders yet, no code entered). */
  readonly canEnterCode: boolean;
  readonly friends: Readonly<Record<ReferralStatus, number>>;
  readonly stamps: {
    readonly count: number;
    readonly goal: number;
    readonly minSubtotalCentavos: Centavos;
  };
  readonly vouchers: readonly VoucherView[];
}

/** What one run of the rewards job did. */
export interface RewardsRun {
  readonly processed: number;
  readonly stamps: number;
  readonly loyaltyVouchers: number;
  readonly referralsRewarded: number;
  readonly referralsVoided: number;
}

/**
 * Referrals and loyalty stamps (docs/BUSINESS.md §4.2, docs/BUILD_PLAN.md Phase 9). Every
 * customer has a referral code; a new customer enters a friend's code before their first order,
 * and both get a ₱50 voucher once that first order is delivered. Guards: no self-referral,
 * existing customers cannot enter codes, one referral per device, and a first order delivered to
 * the referrer's own address voids it. Each delivered order of ₱150+ earns a stamp; 10 stamps
 * become a free-delivery voucher. Rewards are personal promo codes, so checkout needs no new path.
 */
export class RewardsService {
  constructor(
    private readonly deps: {
      rewards: IRewardsRepository;
      hasher: IContentHasher;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  async summary(user: SessionUser | null): Promise<Result<RewardsSummary, AppError>> {
    if (!user) return err(new UnauthorizedError());
    const { rewards } = this.deps;
    const [referralCode, referredBy, friends, orders, stamps, vouchers] = await Promise.all([
      rewards.referralCode(user.id),
      rewards.referralOf(user.id),
      rewards.referralCounts(user.id),
      rewards.orderCount(user.id),
      rewards.openStamps(user.id),
      rewards.vouchers(user.id),
    ]);
    return ok({
      referralCode,
      rewardCentavos: REFERRAL_REWARD_CENTAVOS,
      referredBy,
      canEnterCode: referredBy === null && orders === 0,
      friends,
      stamps: {
        count: stamps,
        goal: STAMPS_PER_REWARD,
        minSubtotalCentavos: STAMP_MIN_SUBTOTAL_CENTAVOS,
      },
      vouchers,
    });
  }

  /** A new customer enters a friend's code (before their first order). */
  async enterReferralCode(
    user: SessionUser | null,
    code: string,
    deviceId: string | null,
  ): Promise<Result<{ readonly status: ReferralStatus }, AppError>> {
    if (!user) return err(new UnauthorizedError());
    const { rewards } = this.deps;
    const invalid = (message: string): Result<never, AppError> =>
      err(new ValidationError(message, [{ path: "code", message }]));
    const referrerId = await rewards.referrerByCode(code);
    if (!referrerId) return invalid("We couldn't find that referral code.");
    if (referrerId === user.id) return invalid("That's your own code. Share it with a friend.");
    if (await rewards.referralOf(user.id)) {
      return err(new ConflictError("You have already entered a friend's code."));
    }
    if ((await rewards.orderCount(user.id)) > 0) {
      return err(new ConflictError("Referral codes are for your first order only."));
    }
    const { deviceHash } = identityHashes(this.deps.hasher, user, deviceId);
    const created = await rewards.createReferral({
      referrerId,
      refereeId: user.id,
      code,
      deviceHash,
    });
    if (!created) {
      this.deps.logger.warn("referral.device_reused", { userId: user.id });
      return err(new ConflictError("A referral code was already used on this phone."));
    }
    this.deps.logger.info("referral.entered", { userId: user.id, referrerId });
    return ok({ status: "pending" });
  }

  /** Works out stamps, loyalty vouchers and referral rewards for delivered orders (background job). */
  async processDelivered(limit = 50): Promise<RewardsRun> {
    const run = {
      processed: 0,
      stamps: 0,
      loyaltyVouchers: 0,
      referralsRewarded: 0,
      referralsVoided: 0,
    };
    for (const facts of await this.deps.rewards.rewardsDue(limit)) {
      const plan = this.plan(facts);
      if (!(await this.deps.rewards.applyRewards(plan))) continue;
      run.processed += 1;
      if (plan.stamp) run.stamps += 1;
      if (plan.loyaltyVoucher) run.loyaltyVouchers += 1;
      if (plan.referral?.outcome === "rewarded") run.referralsRewarded += 1;
      if (plan.referral?.outcome === "void") run.referralsVoided += 1;
      this.deps.logger.info("rewards.processed", {
        orderId: facts.orderId,
        stamp: plan.stamp,
        loyaltyVoucher: plan.loyaltyVoucher !== null,
        referral: plan.referral?.outcome ?? "none",
      });
    }
    return run;
  }

  /** The decisions for one delivered order (pure, so it is easy to test). */
  plan(facts: RewardFacts): RewardPlan {
    const endsAt = new Date(this.deps.clock.now().getTime() + VOUCHER_DAYS * 24 * 60 * 60 * 1000);
    const stamp = facts.subtotalCentavos >= STAMP_MIN_SUBTOTAL_CENTAVOS;
    const stamps = facts.openStamps + (stamp ? 1 : 0);
    const loyaltyVoucher =
      stamp && stamps >= STAMPS_PER_REWARD
        ? {
            stamps: STAMPS_PER_REWARD,
            voucher: {
              ownerId: facts.customerId,
              source: "loyalty",
              type: "free_delivery",
              discountCentavos: null,
              maxDiscountCentavos: null,
              description: "Free delivery: 10 stamps collected",
              endsAt,
            } satisfies VoucherSpec,
          }
        : null;

    let referral: RewardPlan["referral"] = null;
    if (facts.referral) {
      if (facts.referral.sameAddressAsReferrer) {
        referral = {
          id: facts.referral.id,
          outcome: "void",
          reason: "First order went to the referrer's own address",
        };
      } else {
        const voucher = (ownerId: string, description: string): VoucherSpec => ({
          ownerId,
          source: "referral",
          type: "fixed_off",
          discountCentavos: REFERRAL_REWARD_CENTAVOS,
          maxDiscountCentavos: null,
          description,
          endsAt,
        });
        referral = {
          id: facts.referral.id,
          outcome: "rewarded",
          referrerVoucher: voucher(facts.referral.referrerId, "₱50 off: a friend joined Klik Go"),
          refereeVoucher: voucher(facts.customerId, "₱50 off: welcome gift from your friend"),
          rewardCentavos: REFERRAL_REWARD_CENTAVOS,
        };
      }
    }
    return {
      orderId: facts.orderId,
      customerId: facts.customerId,
      stamp,
      loyaltyVoucher,
      referral,
    };
  }
}
