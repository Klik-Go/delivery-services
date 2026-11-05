import { createHash } from "node:crypto";
import type {
  ApplicationApproval,
  IMerchantApplicationRepository,
  IZoneLocator,
  GeoPoint,
  MerchantApplication,
  NewMerchantApplication,
} from "@klikgo/core";
import type { PrismaClient } from "@klikgo/db";
import type { MerchantApplicationStatus, MerchantCategory } from "@klikgo/types";

interface ApplicationRow {
  id: string;
  business_name: string;
  owner_name: string;
  phone: string;
  email: string;
  category: MerchantCategory;
  barangay: string;
  city: string;
  address_line: string | null;
  lat: number;
  lng: number;
  zone_id: string | null;
  zone_name: string | null;
  status: MerchantApplicationStatus;
  merchant_id: string | null;
  rejection_reason: string | null;
  created_at: Date;
}

const SELECT_APPLICATION = `
  select a.id, a.business_name, a.owner_name, a.phone, a.email, a.category::text as category,
         a.barangay, a.city, a.address_line,
         extensions.st_y(a.location::extensions.geometry) as lat,
         extensions.st_x(a.location::extensions.geometry) as lng,
         a.zone_id, z.name as zone_name, a.status::text as status, a.merchant_id,
         a.rejection_reason, a.created_at
  from public.merchant_applications a left join public.zones z on z.id = a.zone_id`;

function toApplication(row: ApplicationRow): MerchantApplication {
  return {
    id: row.id,
    businessName: row.business_name,
    ownerName: row.owner_name,
    phone: row.phone,
    email: row.email,
    category: row.category,
    barangay: row.barangay,
    city: row.city,
    addressLine: row.address_line,
    location: { lat: Number(row.lat), lng: Number(row.lng) },
    zoneId: row.zone_id,
    zoneName: row.zone_name,
    status: row.status,
    merchantId: row.merchant_id,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
  };
}

/** Finds the zone covering a pin with PostGIS (active zones first). */
export class PrismaZoneLocator implements IZoneLocator {
  constructor(private readonly prisma: PrismaClient) {}

  async zoneAt(point: GeoPoint): Promise<{ id: string; name: string } | null> {
    const rows = await this.prisma.$queryRaw<{ id: string; name: string }[]>`
      select id, name from public.zones
      where extensions.st_covers(area,
        extensions.st_setsrid(extensions.st_makepoint(${point.lng}, ${point.lat}), 4326)::extensions.geography)
      order by is_active desc, created_at limit 1`;
    return rows[0] ?? null;
  }
}

/**
 * merchant_applications through Prisma. Geography columns need SQL; every value is a bound
 * parameter (tagged templates), never interpolated text.
 */
export class PrismaMerchantApplicationRepository implements IMerchantApplicationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(application: NewMerchantApplication): Promise<{ id: string }> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      insert into public.merchant_applications
        (business_name, owner_name, phone, email, category, barangay, city, address_line, location, zone_id)
      values (${application.businessName}, ${application.ownerName}, ${application.phone},
              ${application.email}, ${application.category}::public.merchant_category,
              ${application.barangay}, ${application.city}, ${application.addressLine},
              extensions.st_setsrid(extensions.st_makepoint(${application.location.lng}, ${application.location.lat}), 4326)::extensions.geography,
              ${application.zoneId}::uuid)
      returning id`;
    const row = rows[0];
    if (!row) throw new Error("insert into merchant_applications returned no row");
    return row;
  }

  async list(filter: {
    status: MerchantApplicationStatus;
    zoneIds: readonly string[] | null;
  }): Promise<MerchantApplication[]> {
    const zoneIds = filter.zoneIds ? [...filter.zoneIds] : null;
    const rows = await this.prisma.$queryRawUnsafe<ApplicationRow[]>(
      `${SELECT_APPLICATION}
       where a.status = $1::public.merchant_application_status
         and ($2::uuid[] is null or a.zone_id = any($2::uuid[]))
       order by a.created_at`,
      filter.status,
      zoneIds,
    );
    return rows.map(toApplication);
  }

  async findById(id: string): Promise<MerchantApplication | null> {
    const rows = await this.prisma.$queryRawUnsafe<ApplicationRow[]>(
      `${SELECT_APPLICATION} where a.id = $1::uuid`,
      id,
    );
    return rows[0] ? toApplication(rows[0]) : null;
  }

  async approve(
    approval: ApplicationApproval,
  ): Promise<{ merchantId: string; slug: string } | null> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        select id from public.merchant_applications
        where id = ${approval.applicationId}::uuid and status = 'pending' and zone_id is not null
        for update`;
      if (locked.length === 0) return null;

      const taken = await tx.$queryRaw<{ slug: string }[]>`
        select slug from public.merchants where slug = ${approval.slug} or slug like ${`${approval.slug}-%`}`;
      const used = new Set(taken.map((row) => row.slug));
      let slug = approval.slug;
      for (let n = 2; used.has(slug); n += 1) slug = `${approval.slug}-${String(n)}`;

      const merchant = await tx.$queryRaw<{ id: string }[]>`
        insert into public.merchants (zone_id, owner_id, name, slug, category, location, address_line,
                                      phone, commission_bps, founding_commission_until, status, is_open)
        select a.zone_id, ${approval.ownerId}::uuid, a.business_name, ${slug}, a.category, a.location,
               a.address_line, a.phone, ${approval.commissionBps}, ${approval.foundingCommissionUntil},
               'active', false
        from public.merchant_applications a where a.id = ${approval.applicationId}::uuid
        returning id`;
      const merchantId = merchant[0]?.id;
      if (!merchantId) throw new Error("insert into merchants returned no row");

      await tx.user_roles.create({
        data: {
          user_id: approval.ownerId,
          role: "merchant_owner",
          merchant_id: merchantId,
          granted_by: approval.reviewerId,
        },
      });
      await tx.invites.create({
        data: {
          email: approval.invite.email,
          role: "merchant_owner",
          merchant_id: merchantId,
          invited_by: approval.reviewerId,
          token_hash: createHash("sha256").update(approval.invite.tokenHash).digest("hex"),
          expires_at: approval.invite.expiresAt,
        },
      });
      await tx.merchant_applications.update({
        where: { id: approval.applicationId },
        data: {
          status: "approved",
          merchant_id: merchantId,
          reviewed_by: approval.reviewerId,
          reviewed_at: new Date(),
        },
      });
      await tx.audit_logs.create({
        data: {
          actor_id: approval.reviewerId,
          actor_role: "admin",
          action: "merchant.approve",
          entity_type: "merchant_applications",
          entity_id: approval.applicationId,
          meta: {
            merchantId,
            commissionBps: approval.commissionBps,
            foundingPartner: approval.foundingCommissionUntil !== null,
          },
        },
      });
      return { merchantId, slug };
    });
  }

  async reject(id: string, reviewerId: string, reason: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.merchant_applications.updateMany({
        where: { id, status: "pending" },
        data: {
          status: "rejected",
          rejection_reason: reason,
          reviewed_by: reviewerId,
          reviewed_at: new Date(),
        },
      });
      if (updated.count === 0) return false;
      await tx.audit_logs.create({
        data: {
          actor_id: reviewerId,
          actor_role: "admin",
          action: "merchant.reject",
          entity_type: "merchant_applications",
          entity_id: id,
        },
      });
      return true;
    });
  }
}
