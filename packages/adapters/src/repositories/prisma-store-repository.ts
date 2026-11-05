import {
  manilaDate,
  type IStoreRepository,
  type IStorefrontRepository,
  type StoreSettings,
  type StoreSettingsUpdate,
  type Storefront,
} from "@klikgo/core";
import type { PrismaClient } from "@klikgo/db";
import { WeeklyHoursSchema, type StoreClosureInput, type WeeklyHours } from "@klikgo/types";

const CLOSED_WEEK: WeeklyHours = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };

/** Hours are jsonb; anything that does not match the schema is shown as "closed" until re-saved. */
function readHours(value: unknown): WeeklyHours {
  const parsed = WeeklyHoursSchema.safeParse(value);
  return parsed.success ? parsed.data : CLOSED_WEEK;
}

/** A calendar date (Postgres `date`, read as UTC midnight) as YYYY-MM-DD. */
function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Store settings, open/closed, closures and public storefront lookups through Prisma. */
export class PrismaStoreRepository implements IStoreRepository, IStorefrontRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async settings(merchantId: string): Promise<StoreSettings | null> {
    const store = await this.prisma.merchants.findUnique({
      where: { id: merchantId },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        is_open: true,
        hours: true,
        default_prep_minutes: true,
        accepts_cod: true,
        service_radius_km: true,
        zones: { select: { max_radius_km: true } },
        merchant_closures: {
          // Past closures no longer matter; "today" is the Manila calendar date.
          where: { closed_on: { gte: new Date(manilaDate(new Date())) } },
          orderBy: { closed_on: "asc" },
          select: { id: true, closed_on: true, reason: true },
        },
      },
    });
    if (!store) return null;
    return {
      merchantId: store.id,
      name: store.name,
      slug: store.slug,
      status: store.status,
      isOpen: store.is_open,
      hours: readHours(store.hours),
      defaultPrepMinutes: store.default_prep_minutes,
      acceptsCod: store.accepts_cod,
      serviceRadiusKm: store.service_radius_km === null ? null : Number(store.service_radius_km),
      zoneMaxRadiusKm: Number(store.zones.max_radius_km),
      closures: store.merchant_closures.map((closure) => ({
        id: closure.id,
        closedOn: isoDate(closure.closed_on),
        reason: closure.reason,
      })),
    };
  }

  async updateSettings(merchantId: string, update: StoreSettingsUpdate): Promise<void> {
    await this.prisma.merchants.update({
      where: { id: merchantId },
      data: {
        hours: update.hours,
        default_prep_minutes: update.defaultPrepMinutes,
        accepts_cod: update.acceptsCod,
        service_radius_km: update.serviceRadiusKm,
      },
    });
  }

  async setOpen(merchantId: string, isOpen: boolean): Promise<void> {
    await this.prisma.merchants.update({ where: { id: merchantId }, data: { is_open: isOpen } });
  }

  async addClosure(merchantId: string, closure: StoreClosureInput): Promise<{ id: string } | null> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      insert into public.merchant_closures (merchant_id, closed_on, reason)
      values (${merchantId}::uuid, ${closure.closedOn}::date, ${closure.reason || null})
      on conflict (merchant_id, closed_on) do nothing
      returning id`;
    return rows[0] ?? null;
  }

  async removeClosure(merchantId: string, closureId: string): Promise<boolean> {
    const deleted = await this.prisma.merchant_closures.deleteMany({
      where: { id: closureId, merchant_id: merchantId },
    });
    return deleted.count > 0;
  }

  async bySlug(slug: string): Promise<Storefront | null> {
    const store = await this.prisma.merchants.findFirst({
      where: { slug, status: "active" },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        category: true,
        is_open: true,
        accepts_cod: true,
        default_prep_minutes: true,
        address_line: true,
      },
    });
    return store
      ? {
          merchantId: store.id,
          name: store.name,
          slug: store.slug,
          description: store.description,
          category: store.category,
          isOpen: store.is_open,
          acceptsCod: store.accepts_cod,
          defaultPrepMinutes: store.default_prep_minutes,
          addressLine: store.address_line,
        }
      : null;
  }
}
