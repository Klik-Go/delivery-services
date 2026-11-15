import type {
  IPromoRepository,
  IWebhookEventStore,
  PromoCustomer,
  PromoRecord,
} from "@klikgo/core";
import type { PrismaClient } from "@klikgo/db";

/** Promo codes with their redemption counts (promos, promo_redemptions). */
export class PrismaPromoRepository implements IPromoRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByCode(code: string, customer: PromoCustomer): Promise<PromoRecord | null> {
    const promo = await this.prisma.promos.findUnique({ where: { code } });
    if (!promo) return null;
    const [[totals], [mine]] = await Promise.all([
      this.prisma.$queryRaw<{ used: number; given: bigint | null }[]>`
        select count(*)::int as used, sum(discount_centavos) as given
          from public.promo_redemptions where promo_id = ${promo.id}::uuid`,
      // The per-customer count matches the account, its phone number or its device.
      this.prisma.$queryRaw<{ used: number }[]>`
        select count(*)::int as used from public.promo_redemptions
         where promo_id = ${promo.id}::uuid
           and (user_id = ${customer.userId}::uuid
                or (${customer.phoneHash}::text is not null and phone_hash = ${customer.phoneHash})
                or (${customer.deviceHash}::text is not null and device_hash = ${customer.deviceHash}))`,
    ]);
    return {
      id: promo.id,
      code: promo.code,
      type: promo.type,
      description: promo.description,
      discountBps: promo.discount_bps,
      discountCentavos: promo.discount_centavos,
      maxDiscountCentavos: promo.max_discount_centavos,
      minSubtotalCentavos: promo.min_subtotal_centavos,
      startsAt: promo.starts_at,
      endsAt: promo.ends_at,
      maxRedemptions: promo.max_redemptions,
      budgetCentavos: promo.budget_centavos,
      perUserLimit: promo.per_user_limit,
      firstOrders: promo.first_orders,
      zoneId: promo.zone_id,
      merchantId: promo.merchant_id,
      ownerId: promo.owner_id,
      source: promo.source === "referral" || promo.source === "loyalty" ? promo.source : "campaign",
      fundedBy: promo.funded_by === "merchant" ? "merchant" : "platform",
      isActive: promo.is_active,
      redemptions: totals?.used ?? 0,
      discountGivenCentavos: Number(totals?.given ?? 0),
      redemptionsByCustomer: mine?.used ?? 0,
    };
  }

  async deliveredOrders(userId: string): Promise<number> {
    return this.prisma.orders.count({ where: { customer_id: userId, status: "delivered" } });
  }
}

/** Webhook deliveries, unique per gateway and event id (webhook_events). */
export class PrismaWebhookEventStore implements IWebhookEventStore {
  constructor(private readonly prisma: PrismaClient) {}

  async record(
    gateway: string,
    eventId: string,
    type: string,
    payload: unknown,
  ): Promise<"new" | "processed" | "pending"> {
    const inserted = await this.prisma.$queryRaw<{ id: string }[]>`
      insert into public.webhook_events (gateway, event_id, type, payload)
      values (${gateway}, ${eventId}, ${type}, ${JSON.stringify(payload ?? {})}::jsonb)
      on conflict (gateway, event_id) do nothing
      returning id`;
    if (inserted.length > 0) return "new";
    const seen = await this.prisma.webhook_events.findUnique({
      where: { gateway_event_id: { gateway, event_id: eventId } },
      select: { processed_at: true },
    });
    return seen?.processed_at ? "processed" : "pending";
  }

  async markProcessed(gateway: string, eventId: string, error: string | null): Promise<void> {
    await this.prisma.webhook_events.update({
      where: { gateway_event_id: { gateway, event_id: eventId } },
      data: { processed_at: new Date(), error },
    });
  }
}
