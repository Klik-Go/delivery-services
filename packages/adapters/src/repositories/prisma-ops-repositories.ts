import type {
  AuditEntry,
  FeatureFlagView,
  FeeRuleFields,
  FeeRuleView,
  IAuditLog,
  IMerchantAdminRepository,
  IOpsOrderRepository,
  IRiderAdminRepository,
  IRiderOnboardingRepository,
  ISettingsRepository,
  IStaffRepository,
  IZoneAdminRepository,
  KycDocument,
  OpsMerchant,
  OpsOrder,
  OpsOrderDetail,
  OpsRider,
  RiderApplication,
  StaffGrant,
  ZonePatch,
  ZoneScope,
  ZoneView,
} from "@klikgo/core";
import { Prisma, type PrismaClient } from "@klikgo/db";
import type {
  AppRole,
  KycDocumentType,
  OrderStatus,
  PaymentMethod,
  VehicleType,
} from "@klikgo/types";

const LIVE: OrderStatus[] = ["placed", "accepted", "preparing", "ready", "picked_up"];

/** SQL filter for a zone scope ("all" or a list of ids). */
function zoneFilter(column: Prisma.Sql, scope: ZoneScope): Prisma.Sql {
  if (scope === "all") return Prisma.sql`true`;
  if (scope.length === 0) return Prisma.sql`false`;
  return Prisma.sql`${column} = any(${[...scope]}::uuid[])`;
}

const toNumber = (value: Prisma.Decimal | number | null): number => Number(value ?? 0);

/** Append-only audit_logs. */
export class PrismaAuditLog implements IAuditLog {
  constructor(private readonly prisma: PrismaClient) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.audit_logs.create({
      data: {
        actor_id: entry.actorId,
        actor_role: entry.actorRole,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        meta: entry.meta,
      },
    });
  }
}

interface OrderRow {
  id: string;
  code: string;
  status: OrderStatus;
  zone_id: string;
  merchant_id: string;
  merchant_name: string;
  payment_method: PaymentMethod;
  total_centavos: number;
  rider_id: string | null;
  rider_name: string | null;
  prep_minutes: number | null;
  placed_at: Date | null;
  accepted_at: Date | null;
  ready_at: Date | null;
  picked_up_at: Date | null;
  sla_flagged_at: Date | null;
  dispatch_flagged_at: Date | null;
  store_lat: number;
  store_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
}

const ORDER_COLUMNS = Prisma.sql`
  o.id, o.code, o.status::text as status, o.zone_id, o.merchant_id, m.name as merchant_name,
  o.payment_method::text as payment_method, o.total_centavos, o.rider_id, rp.full_name as rider_name,
  case when o.accepted_at is not null then o.prep_minutes end as prep_minutes,
  o.placed_at, o.accepted_at, o.ready_at, o.picked_up_at, o.sla_flagged_at, o.dispatch_flagged_at,
  extensions.st_y(m.location::extensions.geometry) as store_lat,
  extensions.st_x(m.location::extensions.geometry) as store_lng,
  extensions.st_y(o.dropoff::extensions.geometry) as dropoff_lat,
  extensions.st_x(o.dropoff::extensions.geometry) as dropoff_lng`;

const ORDER_JOINS = Prisma.sql`
  from public.orders o
  join public.merchants m on m.id = o.merchant_id
  left join public.riders r on r.id = o.rider_id
  left join public.profiles rp on rp.id = r.user_id`;

function toOpsOrder(row: OrderRow): OpsOrder {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    zoneId: row.zone_id,
    merchantId: row.merchant_id,
    merchantName: row.merchant_name,
    paymentMethod: row.payment_method,
    totalCentavos: row.total_centavos,
    riderId: row.rider_id,
    riderName: row.rider_name,
    prepMinutes: row.prep_minutes,
    placedAt: row.placed_at,
    acceptedAt: row.accepted_at,
    readyAt: row.ready_at,
    pickedUpAt: row.picked_up_at,
    flaggedAt: row.sla_flagged_at,
    dispatchFlaggedAt: row.dispatch_flagged_at,
    store: { lat: row.store_lat, lng: row.store_lng },
    dropoff: { lat: row.dropoff_lat, lng: row.dropoff_lng },
  };
}

/** Live orders, riders on the map, (re)assignment and support notes. */
export class PrismaOpsOrders implements IOpsOrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async board(scope: ZoneScope): Promise<OpsOrder[]> {
    const rows = await this.prisma.$queryRaw<OrderRow[]>`
      select ${ORDER_COLUMNS} ${ORDER_JOINS}
       where o.status::text = any(${LIVE}) and ${zoneFilter(Prisma.sql`o.zone_id`, scope)}
       order by coalesce(o.placed_at, o.created_at)
       limit 300`;
    return rows.map(toOpsOrder);
  }

  async order(orderId: string): Promise<OpsOrderDetail | null> {
    const [row] = await this.prisma.$queryRaw<
      (OrderRow & {
        customer_id: string;
        payment_status: OpsOrderDetail["paymentStatus"];
        cancel_reason: string | null;
        reject_reason: string | null;
      })[]
    >`
      select ${ORDER_COLUMNS}, o.customer_id, o.payment_status::text as payment_status,
             o.cancel_reason, o.reject_reason
        ${ORDER_JOINS}
       where o.id = ${orderId}::uuid`;
    if (!row) return null;
    const [events, notes] = await Promise.all([
      this.prisma.order_events.findMany({
        where: { order_id: orderId },
        orderBy: { created_at: "asc" },
        select: { created_at: true, from_status: true, to_status: true, actor_role: true },
      }),
      this.prisma.order_support_notes.findMany({
        where: { order_id: orderId },
        orderBy: { created_at: "asc" },
        include: { profiles: { select: { full_name: true, email: true } } },
      }),
    ]);
    return {
      ...toOpsOrder(row),
      customerId: row.customer_id,
      paymentStatus: row.payment_status,
      cancelReason: row.cancel_reason,
      rejectReason: row.reject_reason,
      history: events.map((e) => ({
        at: e.created_at,
        from: e.from_status,
        to: e.to_status,
        actorRole: e.actor_role,
      })),
      notes: notes.map((n) => ({
        id: n.id,
        body: n.body,
        authorRole: n.author_role,
        authorName: n.profiles?.full_name ?? n.profiles?.email ?? null,
        at: n.created_at,
      })),
    };
  }

  async rider(riderId: string): Promise<OpsRider | null> {
    const [row] = await this.riderRows(Prisma.sql`r.id = ${riderId}::uuid`);
    return row ?? null;
  }

  riders(scope: ZoneScope): Promise<OpsRider[]> {
    return this.riderRows(zoneFilter(Prisma.sql`r.zone_id`, scope));
  }

  private async riderRows(where: Prisma.Sql): Promise<OpsRider[]> {
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        user_id: string;
        name: string | null;
        zone_id: string;
        status: OpsRider["status"];
        is_online: boolean;
        active_order_id: string | null;
        lat: number | null;
        lng: number | null;
        location_at: Date | null;
      }[]
    >`
      select r.id, r.user_id, p.full_name as name, r.zone_id, r.status::text as status, r.is_online,
             (select o.id from public.orders o
               where o.rider_id = r.id and o.status in ('accepted', 'preparing', 'ready', 'picked_up')
               limit 1) as active_order_id,
             extensions.st_y(l.location::extensions.geometry) as lat,
             extensions.st_x(l.location::extensions.geometry) as lng,
             l.updated_at as location_at
        from public.riders r
        join public.profiles p on p.id = r.user_id
        left join public.rider_locations l on l.rider_id = r.id
       where ${where}
       order by p.full_name nulls last`;
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      zoneId: row.zone_id,
      status: row.status,
      isOnline: row.is_online,
      activeOrderId: row.active_order_id,
      location: row.lat === null || row.lng === null ? null : { lat: row.lat, lng: row.lng },
      locationAt: row.location_at,
    }));
  }

  async assignRider(input: {
    readonly orderId: string;
    readonly riderId: string;
    readonly expectedRiderId: string | null;
    readonly earningsCentavos: number;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const [order] = await tx.$queryRaw<{ rider_id: string | null }[]>`
        select rider_id from public.orders
         where id = ${input.orderId}::uuid and status in ('accepted', 'preparing', 'ready')
         for update`;
      if (!order || order.rider_id !== input.expectedRiderId) return false;
      // Open offers for this order (to anyone) end: the coordinator decided.
      await tx.dispatch_offers.updateMany({
        where: { order_id: input.orderId, status: "offered" },
        data: { status: "expired", responded_at: new Date() },
      });
      await tx.orders.update({
        where: { id: input.orderId },
        data: {
          rider_id: input.riderId,
          rider_earnings_centavos: input.earningsCentavos,
          dispatch_status: "assigned",
          arrived_store_at: null,
        },
      });
      return true;
    });
  }

  async addNote(input: {
    readonly orderId: string;
    readonly authorId: string;
    readonly authorRole: AppRole;
    readonly body: string;
  }): Promise<string> {
    const note = await this.prisma.order_support_notes.create({
      data: {
        order_id: input.orderId,
        author_id: input.authorId,
        author_role: input.authorRole,
        body: input.body,
      },
      select: { id: true },
    });
    return note.id;
  }
}

/** Zones, outlines, coordinators and fee rules. */
export class PrismaZoneAdmin implements IZoneAdminRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async zones(scope: ZoneScope): Promise<ZoneView[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      select id from public.zones where ${zoneFilter(Prisma.sql`id`, scope)} order by name`;
    const zones = await Promise.all(rows.map((row) => this.zone(row.id)));
    return zones.filter((zone): zone is ZoneView => zone !== null);
  }

  async zone(zoneId: string): Promise<ZoneView | null> {
    const [row] = await this.prisma.$queryRaw<
      {
        id: string;
        name: string;
        slug: string;
        zone_type: ZoneView["zoneType"];
        base_fee_centavos: number;
        per_km_centavos: number;
        max_radius_km: Prisma.Decimal;
        is_active: boolean;
        coordinator_id: string | null;
        coordinator_name: string | null;
        area: string;
      }[]
    >`
      select z.id, z.name, z.slug, z.zone_type::text as zone_type, z.base_fee_centavos, z.per_km_centavos, z.max_radius_km,
             z.is_active, z.coordinator_id, coalesce(p.full_name, p.email) as coordinator_name,
             extensions.st_asgeojson(z.area::extensions.geometry) as area
        from public.zones z left join public.profiles p on p.id = z.coordinator_id
       where z.id = ${zoneId}::uuid`;
    if (!row) return null;
    const rules = await this.prisma.fee_rules.findMany({
      where: { zone_id: zoneId },
      orderBy: [{ kind: "asc" }, { priority: "asc" }],
    });
    const geometry = JSON.parse(row.area) as { coordinates: [number, number][][] };
    const outer = geometry.coordinates[0] ?? [];
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      zoneType: row.zone_type,
      baseFeeCentavos: row.base_fee_centavos,
      perKmCentavos: row.per_km_centavos,
      maxRadiusKm: toNumber(row.max_radius_km),
      isActive: row.is_active,
      coordinatorId: row.coordinator_id,
      coordinatorName: row.coordinator_name,
      // GeoJSON repeats the first corner at the end; the console works with open rings.
      ring: outer.slice(0, -1).map(([lng, lat]) => [lng, lat] as const),
      feeRules: rules.map(toFeeRule),
    };
  }

  async update(zoneId: string, patch: ZonePatch): Promise<boolean> {
    const result = await this.prisma.zones.updateMany({
      where: { id: zoneId },
      data: {
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.baseFeeCentavos === undefined
          ? {}
          : { base_fee_centavos: patch.baseFeeCentavos }),
        ...(patch.perKmCentavos === undefined ? {} : { per_km_centavos: patch.perKmCentavos }),
        ...(patch.maxRadiusKm === undefined ? {} : { max_radius_km: patch.maxRadiusKm }),
        ...(patch.isActive === undefined ? {} : { is_active: patch.isActive }),
      },
    });
    return result.count > 0;
  }

  async setArea(
    zoneId: string,
    ring: readonly (readonly [number, number])[],
  ): Promise<"ok" | "invalid" | "missing"> {
    const first = ring[0];
    if (!first) return "invalid";
    const geojson = JSON.stringify({ type: "Polygon", coordinates: [[...ring, first]] });
    const [check] = await this.prisma.$queryRaw<{ valid: boolean }[]>`
      select extensions.st_isvalid(extensions.st_setsrid(extensions.st_geomfromgeojson(${geojson}), 4326)) as valid`;
    if (!check?.valid) return "invalid";
    const updated = await this.prisma.$executeRaw`
      update public.zones
         set area = extensions.st_setsrid(extensions.st_geomfromgeojson(${geojson}), 4326)::extensions.geography
       where id = ${zoneId}::uuid`;
    return updated > 0 ? "ok" : "missing";
  }

  async isZoneCoordinator(userId: string, zoneId: string): Promise<boolean> {
    const grant = await this.prisma.user_roles.findFirst({
      where: { user_id: userId, role: "coordinator", zone_id: zoneId },
      select: { id: true },
    });
    return grant !== null;
  }

  async setCoordinator(zoneId: string, userId: string | null): Promise<boolean> {
    const result = await this.prisma.zones.updateMany({
      where: { id: zoneId },
      data: { coordinator_id: userId },
    });
    return result.count > 0;
  }

  async feeRule(ruleId: string): Promise<FeeRuleView | null> {
    const rule = await this.prisma.fee_rules.findUnique({ where: { id: ruleId } });
    return rule ? toFeeRule(rule) : null;
  }

  async createFeeRule(zoneId: string, fields: FeeRuleFields): Promise<string> {
    const rule = await this.prisma.fee_rules.create({
      data: {
        zone_id: zoneId,
        name: fields.name,
        kind: fields.kind,
        min_distance_m: fields.minDistanceM,
        max_distance_m: fields.maxDistanceM,
        min_subtotal_centavos: fields.minSubtotalCentavos,
        fee_centavos: fields.feeCentavos,
        priority: fields.priority,
        is_active: fields.isActive,
      },
      select: { id: true },
    });
    return rule.id;
  }

  async updateFeeRule(ruleId: string, patch: Partial<FeeRuleFields>): Promise<boolean> {
    const result = await this.prisma.fee_rules.updateMany({
      where: { id: ruleId },
      data: feeRuleData(patch),
    });
    return result.count > 0;
  }
}

function toFeeRule(rule: {
  id: string;
  zone_id: string;
  name: string;
  kind: FeeRuleView["kind"];
  min_distance_m: number | null;
  max_distance_m: number | null;
  min_subtotal_centavos: number | null;
  fee_centavos: number;
  priority: number;
  is_active: boolean;
}): FeeRuleView {
  return {
    id: rule.id,
    zoneId: rule.zone_id,
    name: rule.name,
    kind: rule.kind,
    minDistanceM: rule.min_distance_m,
    maxDistanceM: rule.max_distance_m,
    minSubtotalCentavos: rule.min_subtotal_centavos,
    feeCentavos: rule.fee_centavos,
    priority: rule.priority,
    isActive: rule.is_active,
  };
}

function feeRuleData(fields: Partial<FeeRuleFields>): {
  name?: string;
  kind?: FeeRuleView["kind"];
  min_distance_m?: number | null;
  max_distance_m?: number | null;
  min_subtotal_centavos?: number | null;
  fee_centavos?: number;
  priority?: number;
  is_active?: boolean;
} {
  return {
    ...(fields.name === undefined ? {} : { name: fields.name }),
    ...(fields.kind === undefined ? {} : { kind: fields.kind }),
    ...(fields.minDistanceM === undefined ? {} : { min_distance_m: fields.minDistanceM }),
    ...(fields.maxDistanceM === undefined ? {} : { max_distance_m: fields.maxDistanceM }),
    ...(fields.minSubtotalCentavos === undefined
      ? {}
      : { min_subtotal_centavos: fields.minSubtotalCentavos }),
    ...(fields.feeCentavos === undefined ? {} : { fee_centavos: fields.feeCentavos }),
    ...(fields.priority === undefined ? {} : { priority: fields.priority }),
    ...(fields.isActive === undefined ? {} : { is_active: fields.isActive }),
  };
}

/** Store status and commission. */
export class PrismaMerchantAdmin implements IMerchantAdminRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async merchants(scope: ZoneScope): Promise<OpsMerchant[]> {
    const rows = await this.prisma.merchants.findMany({
      where: scope === "all" ? {} : { zone_id: { in: [...scope] } },
      orderBy: { name: "asc" },
    });
    return rows.map(toMerchant);
  }

  async merchant(merchantId: string): Promise<OpsMerchant | null> {
    const row = await this.prisma.merchants.findUnique({ where: { id: merchantId } });
    return row ? toMerchant(row) : null;
  }

  async setStatus(
    merchantId: string,
    status: "active" | "suspended",
    reason: string | null,
  ): Promise<boolean> {
    const result = await this.prisma.merchants.updateMany({
      where: { id: merchantId },
      // A suspended store also stops taking orders straight away.
      data: {
        status,
        status_reason: reason,
        ...(status === "suspended" ? { is_open: false } : {}),
      },
    });
    return result.count > 0;
  }

  async setCommission(merchantId: string, bps: number, from: Date, now: Date): Promise<boolean> {
    const result = await this.prisma.merchants.updateMany({
      where: { id: merchantId },
      data:
        from <= now
          ? { commission_bps: bps, next_commission_bps: null, next_commission_from: null }
          : { next_commission_bps: bps, next_commission_from: from },
    });
    return result.count > 0;
  }
}

function toMerchant(row: {
  id: string;
  name: string;
  slug: string;
  zone_id: string;
  status: OpsMerchant["status"];
  status_reason: string | null;
  commission_bps: number;
  next_commission_bps: number | null;
  next_commission_from: Date | null;
  founding_commission_until: Date | null;
}): OpsMerchant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    zoneId: row.zone_id,
    status: row.status,
    statusReason: row.status_reason,
    commissionBps: row.commission_bps,
    nextCommissionBps: row.next_commission_bps,
    nextCommissionFrom: row.next_commission_from,
    foundingCommissionUntil: row.founding_commission_until,
  };
}

const RIDER_INCLUDE = {
  profiles: { select: { full_name: true, phone: true } },
  rider_kyc_documents: { orderBy: { created_at: "asc" } },
} as const;

type RiderWithDocs = Prisma.ridersGetPayload<{ include: typeof RIDER_INCLUDE }>;

function toApplication(row: RiderWithDocs): RiderApplication {
  // The latest upload of each type counts (earlier ones were rejected and replaced).
  const latest = new Map<KycDocumentType, KycDocument>();
  for (const doc of row.rider_kyc_documents) {
    latest.set(doc.type, {
      id: doc.id,
      riderId: doc.rider_id,
      type: doc.type,
      storagePath: doc.storage_path,
      status: doc.status,
      rejectionReason: doc.rejection_reason,
      uploadedAt: doc.created_at,
    });
  }
  return {
    id: row.id,
    userId: row.user_id,
    name: row.profiles.full_name,
    phone: row.profiles.phone ? `+${row.profiles.phone.replace(/^\+/, "")}` : null,
    zoneId: row.zone_id,
    vehicleType: row.vehicle_type,
    plateNo: row.plate_no,
    payoutAccountName: row.payout_account_name,
    status: row.status,
    statusReason: row.status_reason,
    ratingAvg: toNumber(row.rating_avg),
    ratingCount: row.rating_count,
    appliedAt: row.created_at,
    documents: [...latest.values()],
  };
}

/** The KYC queue and rider status. */
export class PrismaRiderAdmin implements IRiderAdminRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async riders(
    scope: ZoneScope,
    filter: "pending" | "active" | "suspended" | "coaching",
  ): Promise<RiderApplication[]> {
    const zone = scope === "all" ? {} : { zone_id: { in: [...scope] } };
    const where =
      filter === "pending"
        ? { status: "pending_kyc" as const }
        : filter === "coaching"
          ? { status: "active" as const, rating_count: { gte: 5 }, rating_avg: { lt: 3.5 } }
          : { status: filter };
    const rows = await this.prisma.riders.findMany({
      where: { ...zone, ...where },
      include: RIDER_INCLUDE,
      orderBy: { created_at: "asc" },
      take: 200,
    });
    return rows.map(toApplication);
  }

  async rider(riderId: string): Promise<RiderApplication | null> {
    const row = await this.prisma.riders.findUnique({
      where: { id: riderId },
      include: RIDER_INCLUDE,
    });
    return row ? toApplication(row) : null;
  }

  async document(documentId: string): Promise<(KycDocument & { readonly zoneId: string }) | null> {
    const doc = await this.prisma.rider_kyc_documents.findUnique({
      where: { id: documentId },
      include: { riders: { select: { zone_id: true } } },
    });
    if (!doc) return null;
    return {
      id: doc.id,
      riderId: doc.rider_id,
      type: doc.type,
      storagePath: doc.storage_path,
      status: doc.status,
      rejectionReason: doc.rejection_reason,
      uploadedAt: doc.created_at,
      zoneId: doc.riders.zone_id,
    };
  }

  async reviewDocument(input: {
    readonly documentId: string;
    readonly status: "approved" | "rejected";
    readonly reason: string | null;
    readonly reviewerId: string;
  }): Promise<boolean> {
    const result = await this.prisma.rider_kyc_documents.updateMany({
      where: { id: input.documentId, status: "pending" },
      data: {
        status: input.status,
        rejection_reason: input.reason,
        reviewed_by: input.reviewerId,
        reviewed_at: new Date(),
      },
    });
    return result.count > 0;
  }

  async setStatus(
    riderId: string,
    status: "active" | "suspended",
    reason: string | null,
  ): Promise<boolean> {
    const result = await this.prisma.riders.updateMany({
      where: { id: riderId, status: { not: status } },
      // Riders only stay online while active (riders_online_requires_active).
      data: { status, status_reason: reason, ...(status === "active" ? {} : { is_online: false }) },
    });
    return result.count > 0;
  }
}

/** Applying to ride and the rider's documents. */
export class PrismaRiderOnboarding implements IRiderOnboardingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async apply(input: {
    readonly userId: string;
    readonly zoneId: string;
    readonly vehicleType: VehicleType;
    readonly plateNo: string | null;
    readonly fullName: string;
    readonly payoutAccountName: string;
  }): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.riders.findUnique({
        where: { user_id: input.userId },
        select: { id: true },
      });
      if (existing) return null;
      const rider = await tx.riders.create({
        data: {
          user_id: input.userId,
          zone_id: input.zoneId,
          vehicle_type: input.vehicleType,
          plate_no: input.plateNo,
          payout_account_name: input.payoutAccountName,
        },
        select: { id: true },
      });
      await tx.profiles.update({
        where: { id: input.userId },
        data: { full_name: input.fullName },
      });
      await tx.$executeRaw`
        insert into public.user_roles (user_id, role)
        select ${input.userId}::uuid, 'rider'
         where not exists (select 1 from public.user_roles where user_id = ${input.userId}::uuid and role = 'rider')`;
      return rider.id;
    });
  }

  async riderForUser(userId: string): Promise<RiderApplication | null> {
    const row = await this.prisma.riders.findUnique({
      where: { user_id: userId },
      include: RIDER_INCLUDE,
    });
    return row ? toApplication(row) : null;
  }

  async addDocument(input: {
    readonly riderId: string;
    readonly type: KycDocumentType;
    readonly storagePath: string;
  }): Promise<string> {
    const doc = await this.prisma.rider_kyc_documents.create({
      data: { rider_id: input.riderId, type: input.type, storage_path: input.storagePath },
      select: { id: true },
    });
    return doc.id;
  }

  async zoneExists(zoneId: string): Promise<boolean> {
    const zone = await this.prisma.zones.findUnique({
      where: { id: zoneId },
      select: { id: true },
    });
    return zone !== null;
  }
}

/** Feature flags. */
export class PrismaSettings implements ISettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async flags(): Promise<FeatureFlagView[]> {
    const rows = await this.prisma.feature_flags.findMany({ orderBy: { key: "asc" } });
    return rows.map(toFlag);
  }

  async flag(key: string): Promise<FeatureFlagView | null> {
    const row = await this.prisma.feature_flags.findUnique({ where: { key } });
    return row ? toFlag(row) : null;
  }

  async updateFlag(
    key: string,
    value: { readonly enabled: boolean; readonly rollout: Readonly<Record<string, unknown>> },
    updatedBy: string,
  ): Promise<boolean> {
    const result = await this.prisma.feature_flags.updateMany({
      where: { key },
      data: {
        enabled: value.enabled,
        rollout: value.rollout as Prisma.InputJsonObject,
        updated_by: updatedBy,
        updated_at: new Date(),
      },
    });
    return result.count > 0;
  }
}

function toFlag(row: {
  key: string;
  description: string | null;
  enabled: boolean;
  rollout: Prisma.JsonValue;
  updated_at: Date;
}): FeatureFlagView {
  const rollout =
    typeof row.rollout === "object" && row.rollout !== null && !Array.isArray(row.rollout)
      ? (row.rollout as Record<string, unknown>)
      : {};
  return {
    key: row.key,
    description: row.description,
    enabled: row.enabled,
    rollout,
    updatedAt: row.updated_at,
  };
}

/** Staff role grants (everyone but customers and riders). */
export class PrismaStaff implements IStaffRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async staff(): Promise<StaffGrant[]> {
    const rows = await this.prisma.user_roles.findMany({
      where: { role: { in: ["admin", "coordinator", "merchant_owner", "merchant_staff"] } },
      include: GRANT_INCLUDE,
      orderBy: [{ role: "asc" }, { created_at: "asc" }],
    });
    return rows.map(toGrant);
  }

  async grant(grantId: string): Promise<StaffGrant | null> {
    const row = await this.prisma.user_roles.findUnique({
      where: { id: grantId },
      include: GRANT_INCLUDE,
    });
    return row ? toGrant(row) : null;
  }

  async revoke(grantId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const grant = await tx.user_roles.findUnique({ where: { id: grantId } });
      if (!grant) return false;
      await tx.user_roles.delete({ where: { id: grantId } });
      if (grant.role === "coordinator" && grant.zone_id) {
        await tx.zones.updateMany({
          where: { id: grant.zone_id, coordinator_id: grant.user_id },
          data: { coordinator_id: null },
        });
      }
      return true;
    });
  }
}

const GRANT_INCLUDE = {
  profiles_user_roles_user_idToprofiles: { select: { full_name: true, email: true } },
  merchants: { select: { name: true } },
  zones: { select: { name: true } },
} as const;

function toGrant(row: Prisma.user_rolesGetPayload<{ include: typeof GRANT_INCLUDE }>): StaffGrant {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.profiles_user_roles_user_idToprofiles.full_name,
    email: row.profiles_user_roles_user_idToprofiles.email,
    role: row.role,
    merchantId: row.merchant_id,
    merchantName: row.merchants?.name ?? null,
    zoneId: row.zone_id,
    zoneName: row.zones?.name ?? null,
    createdAt: row.created_at,
  };
}
