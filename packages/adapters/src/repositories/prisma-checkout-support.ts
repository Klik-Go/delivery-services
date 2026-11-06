import type { IPromoRepository, IWebhookEventStore, PromoRecord } from "@klikgo/core";
import type { PrismaClient } from "@klikgo/db";

/** Promo codes with their redemption counts (promos, promo_redemptions). */
export class PrismaPromoRepository implements IPromoRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByCode(code: string, userId: string): Promise<PromoRecord | null> {
    const promo = await this.prisma.promos.findUnique({ where: { code } });
    if (!promo) return null;
    const [redemptions, redemptionsByUser] = await Promise.all([
      this.prisma.promo_redemptions.count({ where: { promo_id: promo.id } }),
      this.prisma.promo_redemptions.count({ where: { promo_id: promo.id, user_id: userId } }),
    ]);
    return {
      id: promo.id,
      code: promo.code,
      type: promo.type,
      discountBps: promo.discount_bps,
      discountCentavos: promo.discount_centavos,
      maxDiscountCentavos: promo.max_discount_centavos,
      minSubtotalCentavos: promo.min_subtotal_centavos,
      startsAt: promo.starts_at,
      endsAt: promo.ends_at,
      maxRedemptions: promo.max_redemptions,
      perUserLimit: promo.per_user_limit,
      zoneId: promo.zone_id,
      merchantId: promo.merchant_id,
      fundedBy: promo.funded_by === "merchant" ? "merchant" : "platform",
      isActive: promo.is_active,
      redemptions,
      redemptionsByUser,
    };
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
