import { randomInt } from "node:crypto";
import type {
  HistoryOrder,
  IOrderHistoryRepository,
  IPromoAdminRepository,
  IRatingRepository,
  IRewardsRepository,
  ITicketRepository,
  PromoSummary,
  RatableOrder,
  RatingRecord,
  RatingWrite,
  ReferralStatus,
  ReorderSource,
  RewardFacts,
  RewardPlan,
  SupportTicket,
  VoucherSpec,
  VoucherView,
  ZoneScope,
} from "@klikgo/core";
import { Prisma, type PrismaClient } from "@klikgo/db";
import type { OrderStatus, PromoCreateInput, PromoType, RatingTargetKind } from "@klikgo/types";

type Tx = Prisma.TransactionClient;

const toNumber = (value: number | bigint | Prisma.Decimal | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value);

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

interface RatableRow {
  id: string;
  code: string;
  customer_id: string;
  merchant_id: string;
  merchant_name: string;
  zone_id: string;
  rider_id: string | null;
  rider_user_id: string | null;
  rider_name: string | null;
  status: OrderStatus;
  delivered_at: Date | null;
}

const ratableColumns = Prisma.sql`
  o.id, o.code, o.customer_id, o.merchant_id, m.name as merchant_name, o.zone_id,
  o.rider_id, r.user_id as rider_user_id, p.full_name as rider_name,
  o.status::text as status, o.delivered_at`;
const ratableFrom = Prisma.sql`
    from public.orders o
    join public.merchants m on m.id = o.merchant_id
    left join public.riders r on r.id = o.rider_id
    left join public.profiles p on p.id = r.user_id`;
const ratableSelect = Prisma.sql`select ${ratableColumns} ${ratableFrom}`;

function toRatable(row: RatableRow): RatableOrder {
  return {
    id: row.id,
    code: row.code,
    customerId: row.customer_id,
    merchantId: row.merchant_id,
    merchantName: row.merchant_name,
    zoneId: row.zone_id,
    riderId: row.rider_id,
    riderUserId: row.rider_user_id,
    riderName: row.rider_name,
    status: row.status,
    deliveredAt: row.delivered_at,
  };
}

interface RatingRow {
  id: string;
  order_id: string;
  from_user_id: string;
  target_type: RatingTargetKind;
  target_id: string;
  score: number;
  tags: string[];
  comment: string | null;
  created_at: Date;
}

function toRating(row: RatingRow): RatingRecord {
  return {
    id: row.id,
    orderId: row.order_id,
    fromUserId: row.from_user_id,
    targetType: row.target_type,
    targetId: row.target_id,
    score: row.score,
    tags: row.tags,
    comment: row.comment,
    createdAt: row.created_at,
  };
}

/** Ratings and the low-rating tickets they open (ratings, support_tickets). */
export class PrismaRatingRepository implements IRatingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async order(orderId: string): Promise<RatableOrder | null> {
    const [row] = await this.prisma.$queryRaw<
      RatableRow[]
    >`${ratableSelect} where o.id = ${orderId}::uuid`;
    return row ? toRatable(row) : null;
  }

  async ratings(orderId: string): Promise<RatingRecord[]> {
    const rows = await this.prisma.$queryRaw<RatingRow[]>`
      select id, order_id, from_user_id, target_type::text as target_type, target_id, score, tags,
             comment, created_at
        from public.ratings where order_id = ${orderId}::uuid order by created_at`;
    return rows.map(toRating);
  }

  async save(rating: RatingWrite): Promise<RatingRecord> {
    return this.prisma.$transaction(async (tx: Tx) => {
      const [row] = await tx.$queryRaw<RatingRow[]>`
        insert into public.ratings (order_id, from_user_id, target_type, target_id, score, tags, comment)
        values (${rating.orderId}::uuid, ${rating.fromUserId}::uuid,
                ${rating.targetType}::public.rating_target, ${rating.targetId}::uuid,
                ${rating.score}::smallint, ${[...rating.tags]}::text[], ${rating.comment})
        on conflict (order_id, from_user_id, target_type) do update
          set score = excluded.score, tags = excluded.tags, comment = excluded.comment,
              target_id = excluded.target_id
        returning id, order_id, from_user_id, target_type::text as target_type, target_id, score,
                  tags, comment, created_at`;
      if (!row) throw new Error("rating upsert returned no row");
      if (rating.ticket) {
        await tx.$executeRaw`
          insert into public.support_tickets (kind, order_id, zone_id, rating_id, summary)
          values ('low_rating', ${rating.orderId}::uuid, ${rating.ticket.zoneId}::uuid,
                  ${row.id}::uuid, ${rating.ticket.summary})
          on conflict (rating_id) do nothing`;
      }
      return toRating(row);
    });
  }

  async riderDeliveries(
    riderUserId: string,
    since: Date,
  ): Promise<{ order: RatableOrder; rating: RatingRecord | null }[]> {
    const rows = await this.prisma.$queryRaw<(RatableRow & { rating: RatingRow | null })[]>`
      select ${ratableColumns}, given.rating
      ${ratableFrom}
      left join lateral (
        select to_jsonb(x) as rating from (
          select rt.id, rt.order_id, rt.from_user_id, rt.target_type::text as target_type,
                 rt.target_id, rt.score, rt.tags, rt.comment, rt.created_at
            from public.ratings rt
           where rt.order_id = o.id and rt.from_user_id = ${riderUserId}::uuid
             and rt.target_type = 'customer') x
      ) given on true
      where r.user_id = ${riderUserId}::uuid and o.status = 'delivered' and o.delivered_at >= ${since}
      order by o.delivered_at desc
      limit 50`;
    return rows.map((row) => ({
      order: toRatable(row),
      rating: row.rating
        ? toRating({ ...row.rating, created_at: new Date(row.rating.created_at) })
        : null,
    }));
  }
}

// ---------------------------------------------------------------------------
// Order history and reorder
// ---------------------------------------------------------------------------

/** The customer's past orders and the lines to order again (orders, order_items). */
export class PrismaOrderHistoryRepository implements IOrderHistoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async history(customerId: string, before: Date | null, limit: number): Promise<HistoryOrder[]> {
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        code: string;
        status: OrderStatus;
        merchant_id: string;
        merchant_name: string;
        merchant_slug: string;
        total_centavos: number;
        created_at: Date;
        delivered_at: Date | null;
        item_count: number;
        items_summary: string | null;
        has_rider: boolean;
        rated: string[];
      }[]
    >`
      select o.id, o.code, o.status::text as status, o.merchant_id, m.name as merchant_name,
             m.slug as merchant_slug, o.total_centavos, o.created_at, o.delivered_at,
             (select coalesce(sum(i.quantity), 0)::int from public.order_items i where i.order_id = o.id) as item_count,
             (select string_agg(i.quantity || '× ' || i.name_snapshot, ', ' order by i.created_at, i.id)
                from public.order_items i where i.order_id = o.id) as items_summary,
             o.rider_id is not null as has_rider,
             array(select rt.target_type::text from public.ratings rt
                    where rt.order_id = o.id and rt.from_user_id = o.customer_id
                      and rt.target_type in ('merchant', 'rider')) as rated
        from public.orders o
        join public.merchants m on m.id = o.merchant_id
       where o.customer_id = ${customerId}::uuid
         and (${before}::timestamptz is null or o.created_at < ${before}::timestamptz)
       order by o.created_at desc
       limit ${limit}`;
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      status: row.status,
      merchantId: row.merchant_id,
      merchantName: row.merchant_name,
      merchantSlug: row.merchant_slug,
      totalCentavos: row.total_centavos,
      createdAt: row.created_at,
      deliveredAt: row.delivered_at,
      itemCount: row.item_count,
      itemsSummary: row.items_summary ?? "",
      hasRider: row.has_rider,
      rated: row.rated.filter((t): t is "merchant" | "rider" => t === "merchant" || t === "rider"),
    }));
  }

  async reorderSource(orderId: string): Promise<ReorderSource | null> {
    const [order] = await this.prisma.$queryRaw<
      {
        id: string;
        customer_id: string;
        merchant_id: string;
        slug: string;
        lat: number;
        lng: number;
      }[]
    >`
      select o.id, o.customer_id, o.merchant_id, m.slug,
             extensions.st_y(o.dropoff::extensions.geometry) as lat,
             extensions.st_x(o.dropoff::extensions.geometry) as lng
        from public.orders o join public.merchants m on m.id = o.merchant_id
       where o.id = ${orderId}::uuid`;
    if (!order) return null;
    const items = await this.prisma.order_items.findMany({
      where: { order_id: orderId },
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
    });
    return {
      orderId: order.id,
      customerId: order.customer_id,
      merchantId: order.merchant_id,
      merchantSlug: order.slug,
      dropoff: { lat: order.lat, lng: order.lng },
      lines: items.map((item) => ({
        menuItemId: item.menu_item_id,
        name: item.name_snapshot,
        quantity: item.quantity,
        optionIds: optionIdsOf(item.modifiers_snapshot),
      })),
    };
  }
}

function optionIdsOf(snapshot: unknown): string[] {
  if (!Array.isArray(snapshot)) return [];
  return snapshot.flatMap((entry: unknown) =>
    entry && typeof entry === "object" && "id" in entry && typeof entry.id === "string"
      ? [entry.id]
      : [],
  );
}

// ---------------------------------------------------------------------------
// Rewards: referral codes, referrals, loyalty stamps, vouchers
// ---------------------------------------------------------------------------

/** Letters and digits that are hard to mix up when read aloud or typed (no 0/O, 1/I/L). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const randomCode = (length: number): string =>
  Array.from({ length }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)] ?? "A").join("");

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return (text.includes("23505") || /unique/i.test(text)) && text.includes(constraint);
}

/** Referrals, stamps and personal vouchers (profiles.referral_code, referrals, loyalty_stamps, promos). */
export class PrismaRewardsRepository implements IRewardsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async referralCode(userId: string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const profile = await this.prisma.profiles.findUnique({
        where: { id: userId },
        select: { referral_code: true },
      });
      if (profile?.referral_code) return profile.referral_code;
      try {
        await this.prisma.$executeRaw`
          update public.profiles set referral_code = ${randomCode(8)}
           where id = ${userId}::uuid and referral_code is null`;
      } catch (error) {
        // Another customer already has this code: try another.
        if (!isUniqueViolation(error, "referral_code")) throw error;
      }
    }
    throw new Error("Could not give the customer a referral code");
  }

  async referrerByCode(code: string): Promise<string | null> {
    const profile = await this.prisma.profiles.findUnique({
      where: { referral_code: code },
      select: { id: true },
    });
    return profile?.id ?? null;
  }

  async referralOf(refereeId: string): Promise<{ status: ReferralStatus } | null> {
    const referral = await this.prisma.referrals.findUnique({
      where: { referee_id: refereeId },
      select: { status: true },
    });
    return referral ? { status: referral.status as ReferralStatus } : null;
  }

  async referralCounts(referrerId: string): Promise<Record<ReferralStatus, number>> {
    const rows = await this.prisma.referrals.groupBy({
      by: ["status"],
      where: { referrer_id: referrerId },
      _count: { _all: true },
    });
    const counts: Record<ReferralStatus, number> = {
      pending: 0,
      qualified: 0,
      rewarded: 0,
      void: 0,
    };
    for (const row of rows) counts[row.status as ReferralStatus] = row._count._all;
    return counts;
  }

  async orderCount(userId: string): Promise<number> {
    return this.prisma.orders.count({
      where: { customer_id: userId, status: { notIn: ["cancelled", "rejected"] } },
    });
  }

  async createReferral(input: {
    referrerId: string;
    refereeId: string;
    code: string;
    deviceHash: string | null;
  }): Promise<boolean> {
    try {
      await this.prisma.referrals.create({
        data: {
          referrer_id: input.referrerId,
          referee_id: input.refereeId,
          code: input.code,
          device_hash: input.deviceHash,
        },
      });
      return true;
    } catch (error) {
      if (
        isUniqueViolation(error, "referrals_device_once") ||
        isUniqueViolation(error, "referee_id")
      ) {
        return false;
      }
      throw error;
    }
  }

  async openStamps(userId: string): Promise<number> {
    return this.prisma.loyalty_stamps.count({
      where: { customer_id: userId, voucher_promo_id: null, redeemed_at: null },
    });
  }

  async vouchers(userId: string): Promise<VoucherView[]> {
    const rows = await this.prisma.$queryRaw<
      {
        code: string;
        type: PromoType;
        source: string;
        description: string | null;
        discount_centavos: number | null;
        max_discount_centavos: number | null;
        ends_at: Date;
        used: boolean;
      }[]
    >`
      select p.code, p.type::text as type, p.source, p.description, p.discount_centavos,
             p.max_discount_centavos, p.ends_at,
             exists (select 1 from public.promo_redemptions r where r.promo_id = p.id) as used
        from public.promos p
       where p.owner_id = ${userId}::uuid
       order by used, p.ends_at`;
    return rows.map((row) => ({
      code: row.code,
      type: row.type,
      source: row.source === "referral" || row.source === "loyalty" ? row.source : "campaign",
      description: row.description,
      discountCentavos: row.discount_centavos,
      maxDiscountCentavos: row.max_discount_centavos,
      endsAt: row.ends_at,
      used: row.used,
    }));
  }

  async rewardsDue(limit: number): Promise<RewardFacts[]> {
    const rows = await this.prisma.$queryRaw<
      {
        order_id: string;
        customer_id: string;
        subtotal_centavos: number;
        open_stamps: number;
        referral_id: string | null;
        referrer_id: string | null;
        same_address: boolean | null;
      }[]
    >`
      select o.id as order_id, o.customer_id, o.subtotal_centavos,
             (select count(*)::int from public.loyalty_stamps s
               where s.customer_id = o.customer_id and s.voucher_promo_id is null
                 and s.redeemed_at is null) as open_stamps,
             ref.id as referral_id, ref.referrer_id,
             -- Within 50 m of a saved address or past dropoff of the referrer: the same household.
             case when ref.id is null then null else (
               exists (select 1 from public.addresses a
                        where a.user_id = ref.referrer_id
                          and extensions.st_dwithin(a.location, o.dropoff, 50))
               or exists (select 1 from public.orders ro
                           where ro.customer_id = ref.referrer_id
                             and extensions.st_dwithin(ro.dropoff, o.dropoff, 50))
             ) end as same_address
        from public.orders o
        left join public.referrals ref on ref.referee_id = o.customer_id and ref.status = 'pending'
       where o.status = 'delivered' and o.rewards_processed_at is null
       order by o.delivered_at
       limit ${limit}`;
    return rows.map((row) => ({
      orderId: row.order_id,
      customerId: row.customer_id,
      subtotalCentavos: row.subtotal_centavos,
      openStamps: row.open_stamps,
      referral:
        row.referral_id && row.referrer_id
          ? {
              id: row.referral_id,
              referrerId: row.referrer_id,
              sameAddressAsReferrer: row.same_address === true,
            }
          : null,
    }));
  }

  async applyRewards(plan: RewardPlan): Promise<boolean> {
    return this.prisma.$transaction(async (tx: Tx) => {
      // Claim the order first: a second run that reaches it later changes nothing.
      const claimed = await tx.$executeRaw`
        update public.orders set rewards_processed_at = now()
         where id = ${plan.orderId}::uuid and rewards_processed_at is null`;
      if (claimed === 0) return false;
      if (plan.stamp) {
        await tx.$executeRaw`
          insert into public.loyalty_stamps (customer_id, order_id)
          values (${plan.customerId}::uuid, ${plan.orderId}::uuid)
          on conflict (order_id) do nothing`;
      }
      if (plan.loyaltyVoucher) {
        const voucherId = await insertVoucher(tx, plan.loyaltyVoucher.voucher);
        await tx.$executeRaw`
          update public.loyalty_stamps set redeemed_at = now(), voucher_promo_id = ${voucherId}::uuid
           where id in (select id from public.loyalty_stamps
                         where customer_id = ${plan.customerId}::uuid and voucher_promo_id is null
                           and redeemed_at is null
                         order by created_at, id
                         limit ${plan.loyaltyVoucher.stamps})`;
      }
      const referral = plan.referral;
      if (referral?.outcome === "rewarded") {
        const referrerPromo = await insertVoucher(tx, referral.referrerVoucher);
        const refereePromo = await insertVoucher(tx, referral.refereeVoucher);
        await tx.$executeRaw`
          update public.referrals
             set status = 'rewarded', qualifying_order_id = ${plan.orderId}::uuid, qualified_at = now(),
                 reward_centavos = ${referral.rewardCentavos}, referrer_promo_id = ${referrerPromo}::uuid,
                 referee_promo_id = ${refereePromo}::uuid
           where id = ${referral.id}::uuid and status = 'pending'`;
      } else if (referral?.outcome === "void") {
        await tx.$executeRaw`
          update public.referrals
             set status = 'void', qualifying_order_id = ${plan.orderId}::uuid, void_reason = ${referral.reason}
           where id = ${referral.id}::uuid and status = 'pending'`;
      }
      return true;
    });
  }
}

/** A single-use personal promo with a random code (REF… or LOYAL…). */
async function insertVoucher(tx: Tx, voucher: VoucherSpec): Promise<string> {
  const prefix = voucher.source === "loyalty" ? "LOYAL" : "REF";
  const [row] = await tx.$queryRaw<{ id: string }[]>`
    insert into public.promos (code, type, discount_centavos, max_discount_centavos, starts_at, ends_at,
                               max_redemptions, per_user_limit, owner_id, source, description)
    values (${prefix + randomCode(8)}, ${voucher.type}::public.promo_type, ${voucher.discountCentavos},
            ${voucher.maxDiscountCentavos}, now(), ${voucher.endsAt}, 1, 1, ${voucher.ownerId}::uuid,
            ${voucher.source}, ${voucher.description})
    returning id`;
  if (!row) throw new Error("voucher insert returned no row");
  return row.id;
}

// ---------------------------------------------------------------------------
// Console: support tickets and promo campaigns
// ---------------------------------------------------------------------------

interface TicketRow {
  id: string;
  status: "open" | "resolved";
  order_id: string;
  order_code: string;
  zone_id: string;
  summary: string;
  comment: string | null;
  created_at: Date;
  resolved_at: Date | null;
  resolution: string | null;
}

const ticketSelect = Prisma.sql`
  select t.id, t.status, t.order_id, o.code as order_code, t.zone_id, t.summary, rt.comment,
         t.created_at, t.resolved_at, t.resolution
    from public.support_tickets t
    join public.orders o on o.id = t.order_id
    left join public.ratings rt on rt.id = t.rating_id`;

function toTicket(row: TicketRow): SupportTicket {
  return {
    id: row.id,
    kind: "low_rating",
    status: row.status,
    orderId: row.order_id,
    orderCode: row.order_code,
    zoneId: row.zone_id,
    summary: row.summary,
    comment: row.comment,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolution: row.resolution,
  };
}

/** Low-rating tickets for the console (support_tickets). */
export class PrismaTicketRepository implements ITicketRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async tickets(scope: ZoneScope, status: "open" | "resolved"): Promise<SupportTicket[]> {
    const zones = scope === "all" ? null : [...scope];
    const rows = await this.prisma.$queryRaw<TicketRow[]>`
      ${ticketSelect}
      where t.status = ${status}
        and (${zones}::uuid[] is null or t.zone_id = any(${zones}::uuid[]))
      order by t.created_at ${status === "open" ? Prisma.sql`asc` : Prisma.sql`desc`}
      limit 100`;
    return rows.map(toTicket);
  }

  async ticket(id: string): Promise<SupportTicket | null> {
    const [row] = await this.prisma.$queryRaw<
      TicketRow[]
    >`${ticketSelect} where t.id = ${id}::uuid`;
    return row ? toTicket(row) : null;
  }

  async resolve(id: string, by: string, resolution: string): Promise<boolean> {
    const changed = await this.prisma.$executeRaw`
      update public.support_tickets
         set status = 'resolved', resolved_at = now(), resolved_by = ${by}::uuid, resolution = ${resolution}
       where id = ${id}::uuid and status = 'open'`;
    return changed > 0;
  }
}

/** Promo campaigns (promos without an owner) with how much they were used. */
export class PrismaPromoAdminRepository implements IPromoAdminRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async campaigns(): Promise<PromoSummary[]> {
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        code: string;
        type: PromoType;
        description: string | null;
        discount_centavos: number | null;
        discount_bps: number | null;
        max_discount_centavos: number | null;
        min_subtotal_centavos: number;
        starts_at: Date;
        ends_at: Date;
        max_redemptions: number | null;
        budget_centavos: number | null;
        per_user_limit: number;
        first_orders: number | null;
        zone_id: string | null;
        merchant_id: string | null;
        is_active: boolean;
        redemptions: number;
        given: bigint | null;
      }[]
    >`
      select p.id, p.code, p.type::text as type, p.description, p.discount_centavos, p.discount_bps,
             p.max_discount_centavos, p.min_subtotal_centavos, p.starts_at, p.ends_at,
             p.max_redemptions, p.budget_centavos, p.per_user_limit, p.first_orders, p.zone_id,
             p.merchant_id, p.is_active,
             (select count(*)::int from public.promo_redemptions r where r.promo_id = p.id) as redemptions,
             (select sum(r.discount_centavos) from public.promo_redemptions r where r.promo_id = p.id) as given
        from public.promos p
       where p.owner_id is null
       order by p.created_at desc
       limit 200`;
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      type: row.type,
      description: row.description,
      discountCentavos: row.discount_centavos,
      discountBps: row.discount_bps,
      maxDiscountCentavos: row.max_discount_centavos,
      minSubtotalCentavos: row.min_subtotal_centavos,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      maxRedemptions: row.max_redemptions,
      budgetCentavos: row.budget_centavos,
      perUserLimit: row.per_user_limit,
      firstOrders: row.first_orders,
      zoneId: row.zone_id,
      merchantId: row.merchant_id,
      isActive: row.is_active,
      redemptions: row.redemptions,
      discountGivenCentavos: toNumber(row.given),
    }));
  }

  async create(input: PromoCreateInput): Promise<string | null> {
    const [row] = await this.prisma.$queryRaw<{ id: string }[]>`
      insert into public.promos (code, type, description, discount_centavos, discount_bps,
                                 max_discount_centavos, min_subtotal_centavos, starts_at, ends_at,
                                 max_redemptions, per_user_limit, budget_centavos, first_orders,
                                 zone_id, merchant_id)
      values (${input.code}, ${input.type}::public.promo_type, ${input.description ?? null},
              ${input.discountCentavos ?? null}, ${input.discountBps ?? null},
              ${input.maxDiscountCentavos ?? null}, ${input.minSubtotalCentavos},
              ${new Date(input.startsAt)}, ${new Date(input.endsAt)}, ${input.maxRedemptions ?? null},
              ${input.perUserLimit}, ${input.budgetCentavos ?? null}, ${input.firstOrders ?? null},
              ${input.zoneId ?? null}::uuid, ${input.merchantId ?? null}::uuid)
      on conflict (code) do nothing
      returning id`;
    return row?.id ?? null;
  }

  async setActive(id: string, isActive: boolean): Promise<boolean> {
    const changed = await this.prisma.$executeRaw`
      update public.promos set is_active = ${isActive} where id = ${id}::uuid and owner_id is null`;
    return changed > 0;
  }
}
