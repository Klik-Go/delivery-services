import { randomInt } from "node:crypto";
import type {
  IInviteCodes,
  IKpiRepository,
  IPilotInviteRepository,
  IPilotSettings,
  InviteSummary,
  KpiDay,
  KpiFigures,
  PilotSettings,
  RedeemOutcome,
  WaitingPerson,
} from "@klikgo/core";
import type { PrismaClient } from "@klikgo/db";
import { MERCHANT_CATEGORIES, type MerchantCategory } from "@klikgo/types";

const num = (value: number | bigint | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value);
const maybe = (value: number | bigint | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

/** Letters and digits without look-alikes (no 0/O, 1/I/L). */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Random 8-character invite codes (about 40 bits; codes are also one-use and rate limited). */
export class RandomInviteCodes implements IInviteCodes {
  next(): string {
    return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  }
}

/** The pilot switches from feature_flags, cached briefly like the other switches. */
export class PrismaPilotSettings implements IPilotSettings {
  private cache: { at: number; value: PilotSettings } | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly ttlMs = 10_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Drops the cache (an admin changed a flag on this server). */
  forget(): void {
    this.cache = null;
  }

  async current(): Promise<PilotSettings> {
    if (this.cache && this.now() - this.cache.at <= this.ttlMs) return this.cache.value;
    const rows = await this.prisma.feature_flags.findMany({
      where: { key: { in: ["invite_only", "pilot_scope", "scheduled_orders"] } },
      select: { key: true, enabled: true, rollout: true },
    });
    const flag = (key: string) => rows.find((r) => r.key === key);
    const rollout = (key: string): Record<string, unknown> => {
      const value = flag(key)?.rollout;
      return value && typeof value === "object" && !Array.isArray(value)
        ? (value)
        : {};
    };
    const max = rollout("invite_only").max_customers;
    const categories = rollout("pilot_scope").categories;
    const value: PilotSettings = {
      inviteOnly: flag("invite_only")?.enabled ?? false,
      maxCustomers: typeof max === "number" && max > 0 ? max : 100,
      categories:
        flag("pilot_scope")?.enabled && Array.isArray(categories)
          ? categories.filter((c): c is MerchantCategory =>
              (MERCHANT_CATEGORIES as readonly unknown[]).includes(c),
            )
          : null,
      // A missing row keeps scheduling on (the behaviour before the switch existed).
      scheduledOrders: flag("scheduled_orders")?.enabled ?? true,
    };
    this.cache = { at: this.now(), value };
    return value;
  }
}

/** pilot_invites and the waitlist. */
export class PrismaPilotInviteRepository implements IPilotInviteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async hasAccess(userId: string): Promise<boolean> {
    return (await this.prisma.pilot_invites.count({ where: { redeemed_by: userId } })) > 0;
  }

  async redeem(
    code: string,
    userId: string,
    maxCustomers: number,
    now: Date,
  ): Promise<RedeemOutcome> {
    const [row] = await this.prisma.$queryRaw<{ result: RedeemOutcome }[]>`
      select private.redeem_invite(${code}, ${userId}::uuid, ${maxCustomers}::integer, ${now}) as result`;
    return row?.result ?? "invalid";
  }

  async create(
    invites: readonly {
      code: string;
      batch: string;
      waitlistId: string | null;
      expiresAt: Date | null;
    }[],
    createdBy: string,
  ): Promise<void> {
    if (invites.length === 0) return;
    await this.prisma.pilot_invites.createMany({
      data: invites.map((i) => ({
        code: i.code,
        batch: i.batch,
        waitlist_id: i.waitlistId,
        expires_at: i.expiresAt,
        created_by: createdBy,
      })),
    });
  }

  async summary(limit: number): Promise<InviteSummary> {
    const [rows, total, redeemed] = await Promise.all([
      this.prisma.pilot_invites.findMany({ orderBy: { created_at: "desc" }, take: limit }),
      this.prisma.pilot_invites.count(),
      this.prisma.pilot_invites.count({ where: { redeemed_by: { not: null } } }),
    ]);
    return {
      invites: rows.map((r) => ({
        code: r.code,
        batch: r.batch,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        sentAt: r.sent_at,
        redeemedAt: r.redeemed_at,
        fromWaitlist: r.waitlist_id !== null,
      })),
      total,
      redeemed,
    };
  }

  async waiting(limit: number): Promise<WaitingPerson[]> {
    const rows = await this.prisma.$queryRaw<{ id: string; name: string; phone: string }[]>`
      select w.id, w.name, w.phone from public.waitlist_signups w
       where not exists (select 1 from public.pilot_invites i where i.waitlist_id = w.id)
       order by w.created_at, w.id
       limit ${limit}::integer`;
    return rows.map((r) => ({ waitlistId: r.id, name: r.name, phone: r.phone }));
  }

  async markSent(code: string, at: Date): Promise<void> {
    await this.prisma.pilot_invites.update({ where: { code }, data: { sent_at: at } });
  }
}

/** KPI figures straight from orders, the ledger, refunds and rider shifts. */
export class PrismaKpiRepository implements IKpiRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async figures(from: Date, to: Date): Promise<KpiFigures> {
    const [row] = await this.prisma.$queryRaw<
      {
        placed: bigint;
        delivered: bigint;
        cancelled_platform: bigint;
        cancelled_customer: bigint;
        cod: bigint;
        gmv: bigint | null;
        revenue: bigint | null;
        promo: bigint | null;
        fees: bigint | null;
        refunds: bigint | null;
        confirm_s: number | null;
        delivery_s: number | null;
        customers: bigint;
        repeat_customers: bigint;
        merchants: bigint;
        riders: bigint;
        rider_earnings: bigint | null;
        online_s: number | null;
        busy_s: number | null;
      }[]
    >`
      with d as (
        select o.* from public.orders o
         where o.status = 'delivered' and o.delivered_at >= ${from} and o.delivered_at < ${to}
      ), ended as (
        select o.* from public.orders o
         where o.status in ('cancelled', 'rejected', 'failed_delivery')
           and coalesce(o.cancelled_at, o.rejected_at, o.failed_at) >= ${from}
           and coalesce(o.cancelled_at, o.rejected_at, o.failed_at) < ${to}
      ), l as (
        select le.account, sum(le.debit_centavos - le.credit_centavos) as net
          from d join public.ledger_entries le on le.order_id = d.id
         where le.account in ('platform_revenue', 'promo_expense', 'gateway_fees')
         group by 1
      ), per_customer as (
        select customer_id, count(*) as n from d group by 1
      ), per_rider as (
        select rider_id, count(*) as n from d where rider_id is not null group by 1
      )
      select
        (select count(*) from public.orders o where o.placed_at >= ${from} and o.placed_at < ${to}) as placed,
        (select count(*) from d) as delivered,
        (select count(*) from ended where coalesce(cancelled_by_role::text, 'system') <> 'customer') as cancelled_platform,
        (select count(*) from ended where cancelled_by_role = 'customer') as cancelled_customer,
        (select count(*) from d where payment_method = 'cod') as cod,
        (select sum(subtotal_centavos + delivery_fee_centavos + service_fee_centavos + small_order_fee_centavos) from d) as gmv,
        (select -net from l where account = 'platform_revenue') as revenue,
        (select net from l where account = 'promo_expense') as promo,
        (select net from l where account = 'gateway_fees') as fees,
        (select sum(f.amount_centavos) from public.refunds f
          where f.status = 'succeeded' and f.created_at >= ${from} and f.created_at < ${to}) as refunds,
        (select avg(extract(epoch from (o.accepted_at - o.placed_at)))::float8 from public.orders o
          where o.accepted_at >= ${from} and o.accepted_at < ${to} and o.placed_at <= o.accepted_at) as confirm_s,
        (select avg(extract(epoch from (delivered_at - accepted_at)))::float8 from d where accepted_at <= delivered_at) as delivery_s,
        (select count(*) from per_customer) as customers,
        (select count(*) from per_customer where n >= 2) as repeat_customers,
        (select count(distinct merchant_id) from d) as merchants,
        (select count(*) from per_rider where n >= 10) as riders,
        (select sum(le.credit_centavos - le.debit_centavos) from public.ledger_entries le
          where le.account = 'rider_payable' and le.order_id is not null
            and le.created_at >= ${from} and le.created_at < ${to}) as rider_earnings,
        (select sum(extract(epoch from (least(coalesce(s.ended_at, ${to}), ${to}) - greatest(s.started_at, ${from}))))::float8
           from public.rider_shifts s
          where s.started_at < ${to} and coalesce(s.ended_at, ${to}) > ${from}) as online_s,
        (select sum(extract(epoch from (d.delivered_at - x.responded_at)))::float8
           from d join public.dispatch_offers x on x.order_id = d.id and x.rider_id = d.rider_id and x.status = 'accepted'
          where x.responded_at <= d.delivered_at) as busy_s`;
    return {
      placed: num(row?.placed),
      delivered: num(row?.delivered),
      cancelledByPlatform: num(row?.cancelled_platform),
      cancelledByCustomer: num(row?.cancelled_customer),
      codDelivered: num(row?.cod),
      gmvCentavos: num(row?.gmv),
      platformRevenueCentavos: num(row?.revenue),
      promoCostCentavos: num(row?.promo),
      gatewayFeesCentavos: num(row?.fees),
      refundsCentavos: num(row?.refunds),
      avgConfirmSeconds: maybe(row?.confirm_s),
      avgDeliverySeconds: maybe(row?.delivery_s),
      customers: num(row?.customers),
      repeatCustomers: num(row?.repeat_customers),
      activeMerchants: num(row?.merchants),
      activeRiders: num(row?.riders),
      riderEarningsCentavos: num(row?.rider_earnings),
      riderOnlineSeconds: Math.round(num(row?.online_s)),
      riderBusySeconds: Math.round(num(row?.busy_s)),
    };
  }

  async daily(days: number, until: Date): Promise<KpiDay[]> {
    const rows = await this.prisma.$queryRaw<
      {
        day: string;
        placed: bigint;
        delivered: bigint;
        gmv: bigint | null;
        confirm_s: number | null;
      }[]
    >`
      with days as (
        select generate_series(
          (timezone('Asia/Manila', ${until}::timestamptz))::date - (${days}::integer - 1),
          (timezone('Asia/Manila', ${until}::timestamptz))::date,
          interval '1 day')::date as day
      )
      select to_char(days.day, 'YYYY-MM-DD') as day,
             (select count(*) from public.orders o
               where (timezone('Asia/Manila', o.placed_at))::date = days.day) as placed,
             (select count(*) from public.orders o
               where o.status = 'delivered' and (timezone('Asia/Manila', o.delivered_at))::date = days.day) as delivered,
             (select sum(o.subtotal_centavos + o.delivery_fee_centavos + o.service_fee_centavos + o.small_order_fee_centavos)
                from public.orders o
               where o.status = 'delivered' and (timezone('Asia/Manila', o.delivered_at))::date = days.day) as gmv,
             (select avg(extract(epoch from (o.accepted_at - o.placed_at)))::float8 from public.orders o
               where o.placed_at <= o.accepted_at and (timezone('Asia/Manila', o.accepted_at))::date = days.day) as confirm_s
        from days
       order by days.day`;
    return rows.map((r) => ({
      day: r.day,
      placed: num(r.placed),
      delivered: num(r.delivered),
      gmvCentavos: num(r.gmv),
      avgConfirmSeconds: r.confirm_s === null ? null : Math.round(r.confirm_s),
    }));
  }
}
