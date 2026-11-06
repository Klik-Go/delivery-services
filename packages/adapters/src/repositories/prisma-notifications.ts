import {
  NOTIFICATION_TEMPLATES,
  type INotificationLog,
  type IPushSubscriptionStore,
  type IRecipientDirectory,
  type NotificationMessage,
  type NotificationParams,
  type NotificationTemplate,
  type PushSubscriptionRecord,
  type QueuedNotification,
} from "@klikgo/core";
import type { PrismaClient } from "@klikgo/db";
import type { NotificationChannel } from "@klikgo/types";
import type { ISmsNumberLookup } from "../notifications/sms-notification-sender";

const isTemplate = (value: string): value is NotificationTemplate =>
  (NOTIFICATION_TEMPLATES as readonly string[]).includes(value);

function paramsOf(payload: unknown): NotificationParams {
  if (typeof payload !== "object" || payload === null) return {};
  return Object.fromEntries(
    Object.entries(payload).filter(
      (entry): entry is [string, string | number] =>
        typeof entry[1] === "string" || typeof entry[1] === "number",
    ),
  );
}

/** The `notifications` table: in-app inbox, send record and the queue the SLA job fills. */
export class PrismaNotificationLog implements INotificationLog {
  constructor(private readonly prisma: PrismaClient) {}

  async start(message: NotificationMessage, channel: NotificationChannel): Promise<string> {
    const row = await this.prisma.notifications.create({
      data: {
        user_id: message.userId,
        channel,
        template: message.template,
        payload: { ...message.params },
        order_id: message.orderId,
        status: "sending",
      },
      select: { id: true },
    });
    return row.id;
  }

  async finish(
    id: string,
    outcome: { readonly ok: true } | { readonly ok: false; readonly error: string },
  ): Promise<void> {
    await this.prisma.notifications.update({
      where: { id },
      data: outcome.ok
        ? { status: "sent", sent_at: new Date(), error: null }
        : { status: "failed", error: outcome.error.slice(0, 200) },
    });
  }

  async claimQueued(limit: number): Promise<QueuedNotification[]> {
    // SKIP LOCKED: two job runs at once take different rows and never send one twice.
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        user_id: string;
        channel: NotificationChannel;
        template: string;
        order_id: string | null;
        payload: unknown;
      }[]
    >`
      update public.notifications n set status = 'sending'
       where n.id in (
         select id from public.notifications
          where status = 'queued' and created_at > now() - interval '1 hour'
          order by created_at
          limit ${limit}
          for update skip locked
       )
      returning n.id, n.user_id, n.channel::text as channel, n.template, n.order_id, n.payload`;
    const claimed: QueuedNotification[] = [];
    for (const row of rows) {
      if (!isTemplate(row.template)) {
        await this.finish(row.id, { ok: false, error: "unknown template" });
        continue;
      }
      claimed.push({
        id: row.id,
        channel: row.channel,
        userId: row.user_id,
        template: row.template,
        orderId: row.order_id,
        params: paramsOf(row.payload),
      });
    }
    return claimed;
  }
}

/** Store teams and the numbers to text them on. */
export class PrismaRecipientDirectory implements IRecipientDirectory, ISmsNumberLookup {
  constructor(private readonly prisma: PrismaClient) {}

  async merchantTeam(merchantId: string): Promise<string[]> {
    const roles = await this.prisma.user_roles.findMany({
      where: { merchant_id: merchantId, role: { in: ["merchant_owner", "merchant_staff"] } },
      select: { user_id: true },
    });
    return [...new Set(roles.map((r) => r.user_id))];
  }

  /**
   * Texts about a store's order go to the store's phone when the person works there (owners sign
   * in by email and may have no phone on their profile); everyone else gets their own phone.
   */
  async smsNumberFor(userId: string, orderId: string | null): Promise<string | null> {
    if (orderId) {
      const rows = await this.prisma.$queryRaw<{ phone: string | null }[]>`
        select m.phone from public.orders o
          join public.merchants m on m.id = o.merchant_id
          join public.user_roles ur on ur.merchant_id = m.id
         where o.id = ${orderId}::uuid and ur.user_id = ${userId}::uuid
           and ur.role in ('merchant_owner', 'merchant_staff')
         limit 1`;
      const phone = rows[0]?.phone;
      if (phone) return phone;
    }
    const profile = await this.prisma.profiles.findUnique({
      where: { id: userId },
      select: { phone: true },
    });
    return profile?.phone ?? null;
  }
}

/** device_push_subscriptions. */
export class PrismaPushSubscriptions implements IPushSubscriptionStore {
  constructor(private readonly prisma: PrismaClient) {}

  async forUser(userId: string): Promise<PushSubscriptionRecord[]> {
    const rows = await this.prisma.device_push_subscriptions.findMany({
      where: { user_id: userId },
      orderBy: { created_at: "desc" },
      take: 10,
    });
    return rows.map((r) => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));
  }

  async save(
    userId: string,
    subscription: PushSubscriptionRecord,
    userAgent: string | null,
  ): Promise<void> {
    const data = {
      user_id: userId,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      user_agent: userAgent,
    };
    await this.prisma.device_push_subscriptions.upsert({
      where: { endpoint: subscription.endpoint },
      create: { endpoint: subscription.endpoint, ...data },
      update: data,
    });
  }

  async remove(endpoint: string, userId: string | null): Promise<void> {
    await this.prisma.device_push_subscriptions.deleteMany({
      where: { endpoint, ...(userId ? { user_id: userId } : {}) },
    });
  }
}
