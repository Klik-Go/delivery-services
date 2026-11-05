import type {
  FeaturedPromo,
  FeeRule,
  GeoPoint,
  IAddressRepository,
  ICatalogReadRepository,
  IPricingCatalog,
  ISearchRepository,
  IServiceArea,
  IWaitlistRepository,
  NewAddress,
  PricedItem,
  QuoteCatalog,
  SavedAddress,
  SearchMatches,
  ServiceZone,
  StoreSummary,
  WaitlistEntry,
  ZoneFees,
} from "@klikgo/core";
import { manilaDate } from "@klikgo/core";
import type { PrismaClient } from "@klikgo/db";
import { WeeklyHoursSchema, type MerchantCategory, type WeeklyHours } from "@klikgo/types";

const CLOSED_WEEK: WeeklyHours = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };

function readHours(value: unknown): WeeklyHours {
  const parsed = WeeklyHoursSchema.safeParse(value);
  return parsed.success ? parsed.data : CLOSED_WEEK;
}

const point = (lng: number, lat: number) => ({ lat: Number(lat), lng: Number(lng) });

/** Active zone for a pin via public.zone_for_point (smallest active zone wins). */
export class PrismaServiceArea implements IServiceArea {
  constructor(private readonly prisma: PrismaClient) {}

  async zoneFor(location: GeoPoint): Promise<ServiceZone | null> {
    const rows = await this.prisma.$queryRaw<ServiceZone[]>`
      select id, name, slug from public.zone_for_point(
        extensions.st_setsrid(extensions.st_makepoint(${location.lng}, ${location.lat}), 4326)::extensions.geography)`;
    return rows[0] ?? null;
  }
}

interface StoreRow {
  id: string;
  slug: string;
  name: string;
  category: MerchantCategory;
  description: string | null;
  cover_photo_path: string | null;
  rating_avg: number;
  rating_count: number;
  lat: number;
  lng: number;
  is_open: boolean;
  hours: unknown;
  closed_dates: string[] | null;
  prep: number;
  radius_km: number;
  min_price: number | null;
  free_delivery: boolean;
}

/** Discovery and pricing reads (live stores only) through Prisma and SQL for PostGIS. */
export class PrismaCatalogRepository implements ICatalogReadRepository, IPricingCatalog {
  constructor(private readonly prisma: PrismaClient) {}

  async storesInZone(zoneId: string): Promise<StoreSummary[]> {
    const today = manilaDate(new Date());
    const rows = await this.prisma.$queryRaw<StoreRow[]>`
      select m.id, m.slug, m.name, m.category::text as category, m.description, m.cover_photo_path,
             m.rating_avg::float8 as rating_avg, m.rating_count,
             extensions.st_y(m.location::extensions.geometry) as lat,
             extensions.st_x(m.location::extensions.geometry) as lng,
             m.is_open, m.hours, m.default_prep_minutes as prep,
             coalesce(m.service_radius_km, z.max_radius_km)::float8 as radius_km,
             (select array_agg(c.closed_on::text order by c.closed_on) from public.merchant_closures c
               where c.merchant_id = m.id and c.closed_on >= ${today}::date) as closed_dates,
             (select min(i.price_centavos) from public.menu_items i
               where i.merchant_id = m.id and i.is_available) as min_price,
             exists (select 1 from public.promos p where p.merchant_id = m.id and p.is_active
                       and p.type = 'free_delivery' and now() between p.starts_at and p.ends_at) as free_delivery
      from public.merchants m join public.zones z on z.id = m.zone_id
      where m.zone_id = ${zoneId}::uuid and m.status = 'active'
      order by m.name`;
    return rows.map((row) => ({
      merchantId: row.id,
      slug: row.slug,
      name: row.name,
      category: row.category,
      description: row.description,
      coverPhotoPath: row.cover_photo_path,
      ratingAvg: Number(row.rating_avg),
      ratingCount: row.rating_count,
      location: point(row.lng, row.lat),
      isOpen: row.is_open,
      hours: readHours(row.hours),
      closedDates: row.closed_dates ?? [],
      prepMinutes: row.prep,
      radiusKm: Number(row.radius_km),
      minItemPriceCentavos: row.min_price,
      hasFreeDeliveryPromo: row.free_delivery,
    }));
  }

  async zoneFees(zoneId: string): Promise<ZoneFees> {
    const zone = await this.prisma.zones.findUniqueOrThrow({
      where: { id: zoneId },
      select: {
        base_fee_centavos: true,
        per_km_centavos: true,
        fee_rules: {
          where: { is_active: true },
          select: {
            kind: true,
            min_distance_m: true,
            max_distance_m: true,
            min_subtotal_centavos: true,
            fee_centavos: true,
            priority: true,
          },
        },
      },
    });
    return {
      baseFeeCentavos: zone.base_fee_centavos,
      perKmCentavos: zone.per_km_centavos,
      rules: zone.fee_rules.map((rule): FeeRule => ({
        kind: rule.kind,
        minDistanceM: rule.min_distance_m,
        maxDistanceM: rule.max_distance_m,
        minSubtotalCentavos: rule.min_subtotal_centavos,
        feeCentavos: rule.fee_centavos,
        priority: rule.priority,
      })),
    };
  }

  async featuredPromos(zoneId: string, now: Date): Promise<FeaturedPromo[]> {
    const promos = await this.prisma.promos.findMany({
      where: {
        is_active: true,
        is_featured: true,
        starts_at: { lte: now },
        ends_at: { gt: now },
        OR: [{ zone_id: zoneId }, { zone_id: null }],
      },
      orderBy: { ends_at: "asc" },
      take: 10,
    });
    return promos.map((promo) => ({
      code: promo.code,
      type: promo.type,
      discountCentavos: promo.discount_centavos,
      discountBps: promo.discount_bps,
      minSubtotalCentavos: promo.min_subtotal_centavos,
      merchantId: promo.merchant_id,
      endsAt: promo.ends_at,
    }));
  }

  async recentMerchantIds(customerId: string, limit: number): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ merchant_id: string }[]>`
      select merchant_id from public.orders where customer_id = ${customerId}::uuid
      group by merchant_id order by max(created_at) desc limit ${limit}`;
    return rows.map((row) => row.merchant_id);
  }

  async loadForQuote(merchantId: string, itemIds: readonly string[]): Promise<QuoteCatalog | null> {
    const [store] = await this.prisma.$queryRaw<(StoreRow & { zone_id: string })[]>`
      select m.id, m.name, m.zone_id, m.is_open, m.hours, m.default_prep_minutes as prep,
             extensions.st_y(m.location::extensions.geometry) as lat,
             extensions.st_x(m.location::extensions.geometry) as lng,
             coalesce(m.service_radius_km, z.max_radius_km)::float8 as radius_km,
             (select array_agg(c.closed_on::text) from public.merchant_closures c
               where c.merchant_id = m.id and c.closed_on >= ${manilaDate(new Date())}::date) as closed_dates
      from public.merchants m join public.zones z on z.id = m.zone_id
      where m.id = ${merchantId}::uuid and m.status = 'active'`;
    if (!store) return null;
    const items = await this.prisma.menu_items.findMany({
      where: { merchant_id: merchantId, id: { in: [...itemIds] } },
      include: {
        modifier_groups: { orderBy: { sort: "asc" }, include: { modifier_options: true } },
      },
    });
    return {
      merchant: {
        id: store.id,
        name: store.name,
        zoneId: store.zone_id,
        location: point(store.lng, store.lat),
        isOpen: store.is_open,
        hours: readHours(store.hours),
        closedDates: store.closed_dates ?? [],
        prepMinutes: store.prep,
        radiusKm: Number(store.radius_km),
      },
      fees: await this.zoneFees(store.zone_id),
      items: items.map((item): PricedItem => ({
        id: item.id,
        name: item.name,
        priceCentavos: item.price_centavos,
        isAvailable: item.is_available,
        groups: item.modifier_groups.map((group) => ({
          id: group.id,
          name: group.name,
          required: group.is_required,
          minSelect: group.min_select,
          maxSelect: group.max_select,
          options: group.modifier_options.map((option) => ({
            id: option.id,
            name: option.name,
            priceDeltaCentavos: option.price_delta_centavos,
            isAvailable: option.is_available,
          })),
        })),
      })),
    };
  }
}

/**
 * Search over live stores and dishes in a zone: full-text ('simple' config) OR trigram similarity,
 * ranked by the better of the two. Every value is a bound parameter.
 */
export class PrismaSearchRepository implements ISearchRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async search(zoneId: string, query: string): Promise<SearchMatches> {
    const q = query.trim().slice(0, 80);
    const stores = await this.prisma.$queryRaw<{ merchant_id: string; score: number }[]>`
      select m.id as merchant_id,
             greatest(ts_rank(to_tsvector('simple', m.name || ' ' || coalesce(m.description, '')),
                              plainto_tsquery('simple', ${q})),
                      extensions.word_similarity(${q}, m.name))::float8 as score
      from public.merchants m
      where m.zone_id = ${zoneId}::uuid and m.status = 'active'
        and (to_tsvector('simple', m.name || ' ' || coalesce(m.description, '')) @@ plainto_tsquery('simple', ${q})
             or extensions.word_similarity(${q}, m.name) > 0.3)
      order by score desc limit 20`;
    const dishes = await this.prisma.$queryRaw<
      {
        item_id: string;
        merchant_id: string;
        name: string;
        price_centavos: number;
        is_available: boolean;
        score: number;
      }[]
    >`
      select i.id as item_id, i.merchant_id, i.name, i.price_centavos, i.is_available,
             greatest(ts_rank(to_tsvector('simple', i.name || ' ' || coalesce(i.description, '')),
                              plainto_tsquery('simple', ${q})),
                      extensions.word_similarity(${q}, i.name))::float8 as score
      from public.menu_items i join public.merchants m on m.id = i.merchant_id
      where m.zone_id = ${zoneId}::uuid and m.status = 'active'
        and (to_tsvector('simple', i.name || ' ' || coalesce(i.description, '')) @@ plainto_tsquery('simple', ${q})
             or extensions.word_similarity(${q}, i.name) > 0.4)
      order by score desc limit 50`;
    return {
      stores: stores.map((row) => ({ merchantId: row.merchant_id, score: Number(row.score) })),
      dishes: dishes.map((row) => ({
        itemId: row.item_id,
        merchantId: row.merchant_id,
        name: row.name,
        priceCentavos: row.price_centavos,
        isAvailable: row.is_available,
        score: Number(row.score),
      })),
    };
  }
}

/** waitlist_signups through Prisma (geography via SQL). */
export class PrismaWaitlistRepository implements IWaitlistRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async add(entry: WaitlistEntry): Promise<{ id: string }> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      insert into public.waitlist_signups (name, phone, email, barangay, city, location)
      values (${entry.name}, ${entry.phone}, ${entry.email}, ${entry.barangay}, ${entry.city},
              extensions.st_setsrid(extensions.st_makepoint(${entry.location.lng}, ${entry.location.lat}), 4326)::extensions.geography)
      returning id`;
    const row = rows[0];
    if (!row) throw new Error("insert into waitlist_signups returned no row");
    return row;
  }
}

/** A customer's saved addresses (the new default replaces the old one in one transaction). */
export class PrismaAddressRepository implements IAddressRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listFor(userId: string): Promise<SavedAddress[]> {
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        label: string;
        lat: number;
        lng: number;
        street: string | null;
        landmark: string | null;
        barangay: string;
        city: string;
        notes: string | null;
        contact_phone: string | null;
        is_default: boolean;
      }[]
    >`
      select id, label, extensions.st_y(location::extensions.geometry) as lat,
             extensions.st_x(location::extensions.geometry) as lng,
             street, landmark, barangay, city, notes, contact_phone, is_default
      from public.addresses where user_id = ${userId}::uuid
      order by is_default desc, created_at`;
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      location: point(row.lng, row.lat),
      street: row.street,
      landmark: row.landmark,
      barangay: row.barangay,
      city: row.city,
      notes: row.notes,
      contactPhone: row.contact_phone,
      isDefault: row.is_default,
    }));
  }

  async create(userId: string, address: NewAddress): Promise<{ id: string }> {
    return this.prisma.$transaction(async (tx) => {
      if (address.isDefault)
        await tx.addresses.updateMany({
          where: { user_id: userId, is_default: true },
          data: { is_default: false },
        });
      const rows = await tx.$queryRaw<{ id: string }[]>`
        insert into public.addresses (user_id, label, location, street, landmark, barangay, city, notes,
                                      contact_phone, is_default)
        values (${userId}::uuid, ${address.label},
                extensions.st_setsrid(extensions.st_makepoint(${address.location.lng}, ${address.location.lat}), 4326)::extensions.geography,
                ${address.street}, ${address.landmark}, ${address.barangay}, ${address.city}, ${address.notes},
                ${address.contactPhone}, ${address.isDefault})
        returning id`;
      const row = rows[0];
      if (!row) throw new Error("insert into addresses returned no row");
      return row;
    });
  }
}
