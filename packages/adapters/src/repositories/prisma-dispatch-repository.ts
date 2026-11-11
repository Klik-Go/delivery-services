import {
  parseDispatchSettings,
  type Centavos,
  type DispatchJob,
  type DispatchSettings,
  type GeoPoint,
  type IDispatchRepository,
  type IDispatchSettingsSource,
  type IRiderRepository,
  type ITrackingRepository,
  type LedgerTxn,
  type OfferAnswer,
  type RiderCandidate,
  type RiderJob,
  type RiderOffer,
  type RiderProfile,
  type SettlementFacts,
  type TrackingFacts,
} from "@klikgo/core";
import type { PrismaClient } from "@klikgo/db";
import type { OrderStatus, PaymentMethod, VehicleType } from "@klikgo/types";
import { postLedger, setActor } from "./prisma-order-repository";

/** Orders a rider can still be found for. */
const AWAITING = ["accepted", "preparing", "ready"] as const;

const point = (lat: number | null, lng: number | null): GeoPoint | null =>
  lat === null || lng === null ? null : { lat, lng };

function snapshotText(snapshot: unknown, key: string): string | null {
  if (typeof snapshot !== "object" || snapshot === null) return null;
  const value = (snapshot as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function area(snapshot: unknown): string | null {
  return snapshotText(snapshot, "barangay") ?? snapshotText(snapshot, "city");
}

/** Raw SQL returns bigint for sums and counts. */
const int = (value: bigint | number | null | undefined): number => Number(value ?? 0);

interface JobRow {
  id: string;
  code: string;
  zone_id: string;
  merchant_name: string;
  status: OrderStatus;
  rider_id: string | null;
  payment_method: PaymentMethod;
  total_centavos: number;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  dispatch_attempts: number;
  dispatch_flagged_at: Date | null;
  ready_by: Date | null;
  has_open_offer: boolean;
}

/**
 * Dispatch, the rider app and live tracking in Postgres (docs/ARCHITECTURE.md §4h). Locations are
 * PostGIS geography, so most reads are SQL; every change that races (offers, answers, pickup,
 * delivery) locks the order row and checks it is still where the caller saw it. Pickup and
 * delivery set the rider as the actor, so the status guard checks the rider transition and writes
 * order_events.
 */
export class PrismaDispatchRepository
  implements IDispatchRepository, IRiderRepository, ITrackingRepository, IDispatchSettingsSource
{
  constructor(private readonly prisma: PrismaClient) {}

  // --- settings -------------------------------------------------------------------------------

  async load(): Promise<DispatchSettings> {
    const flag = await this.prisma.feature_flags.findUnique({
      where: { key: "dispatch" },
      select: { rollout: true },
    });
    return parseDispatchSettings(flag?.rollout ?? null);
  }

  // --- IDispatchRepository --------------------------------------------------------------------

  async job(orderId: string): Promise<DispatchJob | null> {
    const [row] = await this.prisma.$queryRaw<JobRow[]>`
      select o.id, o.code, o.zone_id, m.name as merchant_name, o.status::text as status, o.rider_id,
             o.payment_method::text as payment_method, o.total_centavos,
             extensions.st_y(m.location::extensions.geometry) as pickup_lat,
             extensions.st_x(m.location::extensions.geometry) as pickup_lng,
             extensions.st_y(o.dropoff::extensions.geometry) as dropoff_lat,
             extensions.st_x(o.dropoff::extensions.geometry) as dropoff_lng,
             o.dispatch_attempts, o.dispatch_flagged_at,
             case when o.accepted_at is not null and o.prep_minutes is not null
                  then o.accepted_at + make_interval(mins => o.prep_minutes) end as ready_by,
             exists (select 1 from public.dispatch_offers d
                      where d.order_id = o.id and d.status = 'offered') as has_open_offer
        from public.orders o join public.merchants m on m.id = o.merchant_id
       where o.id = ${orderId}::uuid`;
    if (!row) return null;
    return {
      id: row.id,
      code: row.code,
      zoneId: row.zone_id,
      merchantName: row.merchant_name,
      status: row.status,
      riderId: row.rider_id,
      paymentMethod: row.payment_method,
      totalCentavos: row.total_centavos,
      pickup: { lat: row.pickup_lat, lng: row.pickup_lng },
      dropoff: { lat: row.dropoff_lat, lng: row.dropoff_lng },
      attempts: row.dispatch_attempts,
      flaggedAt: row.dispatch_flagged_at,
      readyBy: row.ready_by,
      hasOpenOffer: row.has_open_offer,
    };
  }

  async candidates(job: DispatchJob, maxDistanceM: number): Promise<RiderCandidate[]> {
    const rows = await this.prisma.$queryRaw<
      {
        rider_id: string;
        user_id: string;
        distance_m: number;
        cash_limit_centavos: number;
        cash_held: bigint | null;
      }[]
    >`
      select n.rider_id, n.user_id, n.distance_m, r.cash_limit_centavos,
             (select coalesce(sum(le.debit_centavos - le.credit_centavos), 0)
                from public.ledger_entries le
               where le.account = 'rider_cash_on_hand' and le.party_id = n.rider_id) as cash_held
        from public.nearest_available_riders(
               extensions.st_setsrid(extensions.st_makepoint(${job.pickup.lng}, ${job.pickup.lat}), 4326)::extensions.geography,
               20, ${Math.round(maxDistanceM)}::integer) n
        join public.riders r on r.id = n.rider_id
       where n.zone_id = ${job.zoneId}::uuid
         and not exists (
           select 1 from public.dispatch_offers d
            where d.rider_id = n.rider_id
              and (d.order_id = ${job.id}::uuid or d.status = 'offered'))
       order by n.distance_m`;
    return rows.map((row) => ({
      riderId: row.rider_id,
      userId: row.user_id,
      distanceM: row.distance_m,
      cashHeldCentavos: int(row.cash_held),
      cashLimitCentavos: row.cash_limit_centavos,
    }));
  }

  async createOffer(input: {
    readonly orderId: string;
    readonly riderId: string;
    readonly earningsCentavos: Centavos;
    readonly expiresAt: Date;
  }): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const [order] = await tx.$queryRaw<{ id: string }[]>`
        select o.id from public.orders o
         where o.id = ${input.orderId}::uuid and o.rider_id is null
           and o.status in ('accepted', 'preparing', 'ready')
           and not exists (select 1 from public.dispatch_offers d
                            where d.order_id = o.id and d.status = 'offered')
         for update`;
      if (!order) return null;
      const [offer] = await tx.$queryRaw<{ id: string }[]>`
        insert into public.dispatch_offers (order_id, rider_id, rider_earnings_centavos, expires_at)
        values (${input.orderId}::uuid, ${input.riderId}::uuid, ${input.earningsCentavos}, ${input.expiresAt})
        on conflict (order_id, rider_id) do nothing
        returning id`;
      if (!offer) return null;
      await tx.orders.update({
        where: { id: input.orderId },
        data: { dispatch_attempts: { increment: 1 }, dispatch_status: "offered" },
      });
      return offer.id;
    });
  }

  async expireDue(now: Date): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ order_id: string }[]>`
      with expired as (
        update public.dispatch_offers set status = 'expired', responded_at = ${now}
         where status = 'offered' and expires_at <= ${now}
        returning order_id
      ), reset as (
        update public.orders o set dispatch_status = 'unassigned'
          from expired e
         where o.id = e.order_id and o.rider_id is null and o.dispatch_status = 'offered'
        returning o.id
      )
      select distinct order_id from expired`;
    return rows.map((row) => row.order_id);
  }

  async awaitingDispatch(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      select o.id from public.orders o
       where o.rider_id is null and o.status in ('accepted', 'preparing', 'ready')
         and not exists (select 1 from public.dispatch_offers d
                          where d.order_id = o.id and d.status = 'offered')
       order by o.accepted_at nulls last
       limit 50`;
    return rows.map((row) => row.id);
  }

  async flag(orderId: string, now: Date): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      with flagged as (
        update public.orders o set dispatch_flagged_at = ${now}
         where o.id = ${orderId}::uuid and o.dispatch_flagged_at is null
        returning o.id, o.code, o.zone_id, o.merchant_id
      ), queued as (
        insert into public.notifications (user_id, channel, template, payload, order_id)
        select distinct r.user_id, c.channel, 'dispatch_unassigned',
               jsonb_build_object('orderId', f.id, 'code', f.code, 'store', m.name), f.id
          from flagged f
          join public.merchants m on m.id = f.merchant_id
          join public.user_roles r on r.role = 'coordinator' and r.zone_id = f.zone_id
          cross join (values ('push'::public.notification_channel),
                             ('in_app'::public.notification_channel)) as c(channel)
        returning 1
      )
      select id from flagged`;
    return rows.length > 0;
  }

  async respond(input: {
    readonly offerId: string;
    readonly riderId: string;
    readonly answer: OfferAnswer;
    readonly now: Date;
  }): Promise<{ readonly orderId: string } | "not_found" | "closed"> {
    return this.prisma.$transaction(async (tx) => {
      const [offer] = await tx.$queryRaw<
        { order_id: string; status: string; expires_at: Date; rider_earnings_centavos: number }[]
      >`
        select order_id, status::text, expires_at, rider_earnings_centavos
          from public.dispatch_offers
         where id = ${input.offerId}::uuid and rider_id = ${input.riderId}::uuid
         for update`;
      if (!offer) return "not_found";
      if (offer.status !== "offered" || offer.expires_at <= input.now) return "closed";
      if (input.answer === "declined") {
        await tx.dispatch_offers.update({
          where: { id: input.offerId },
          data: { status: "declined", responded_at: input.now },
        });
        await tx.orders.updateMany({
          where: { id: offer.order_id, rider_id: null },
          data: { dispatch_status: "unassigned" },
        });
        return { orderId: offer.order_id };
      }
      const [order] = await tx.$queryRaw<{ id: string }[]>`
        select id from public.orders
         where id = ${offer.order_id}::uuid and rider_id is null
           and status in ('accepted', 'preparing', 'ready')
         for update`;
      if (!order) {
        await tx.dispatch_offers.update({
          where: { id: input.offerId },
          data: { status: "expired", responded_at: input.now },
        });
        return "closed";
      }
      await tx.dispatch_offers.update({
        where: { id: input.offerId },
        data: { status: "accepted", responded_at: input.now },
      });
      await tx.orders.update({
        where: { id: offer.order_id },
        data: {
          rider_id: input.riderId,
          rider_earnings_centavos: offer.rider_earnings_centavos,
          dispatch_status: "assigned",
        },
      });
      return { orderId: offer.order_id };
    });
  }

  // --- IRiderRepository -----------------------------------------------------------------------

  async riderForUser(userId: string): Promise<RiderProfile | null> {
    const row = await this.prisma.riders.findUnique({
      where: { user_id: userId },
      include: { profiles: { select: { full_name: true } } },
    });
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      zoneId: row.zone_id,
      status: row.status,
      isOnline: row.is_online,
      fullName: row.profiles.full_name,
      vehicleType: row.vehicle_type,
      plateNo: row.plate_no,
      cashLimitCentavos: row.cash_limit_centavos,
    };
  }

  async setOnline(riderId: string, online: boolean): Promise<void> {
    await this.prisma.riders.update({ where: { id: riderId }, data: { is_online: online } });
  }

  async saveLocation(
    riderId: string,
    fix: GeoPoint & {
      readonly heading?: number;
      readonly speedKph?: number;
      readonly accuracyM?: number;
    },
    now: Date,
    minIntervalMs: number,
  ): Promise<boolean> {
    const heading = fix.heading === undefined ? null : Math.round(fix.heading) % 360;
    const speed = fix.speedKph === undefined ? null : Math.max(0, fix.speedKph);
    const accuracy = fix.accuracyM === undefined ? null : Math.max(0, fix.accuracyM);
    // Upsert only when the stored fix is older than the interval: the throttle is one statement.
    const rows = await this.prisma.$queryRaw<{ rider_id: string }[]>`
      insert into public.rider_locations (rider_id, location, heading, speed_kph, accuracy_m, updated_at)
      values (${riderId}::uuid,
              extensions.st_setsrid(extensions.st_makepoint(${fix.lng}, ${fix.lat}), 4326)::extensions.geography,
              ${heading}::smallint, ${speed}::numeric, ${accuracy}::numeric, ${now})
      on conflict (rider_id) do update set
        location = excluded.location, heading = excluded.heading, speed_kph = excluded.speed_kph,
        accuracy_m = excluded.accuracy_m, updated_at = excluded.updated_at
      where public.rider_locations.updated_at <= excluded.updated_at - make_interval(secs => ${minIntervalMs / 1000})
      returning rider_id`;
    return rows.length > 0;
  }

  async addBreadcrumb(riderId: string, orderId: string, at: GeoPoint, now: Date): Promise<void> {
    await this.prisma.$executeRaw`
      insert into public.rider_location_breadcrumbs (rider_id, order_id, location, recorded_at)
      values (${riderId}::uuid, ${orderId}::uuid,
              extensions.st_setsrid(extensions.st_makepoint(${at.lng}, ${at.lat}), 4326)::extensions.geography,
              ${now})`;
  }

  async currentOffer(riderId: string, now: Date): Promise<RiderOffer | null> {
    const [row] = await this.prisma.$queryRaw<
      {
        offer_id: string;
        order_id: string;
        code: string;
        store_name: string;
        store_address: string | null;
        pickup_lat: number;
        pickup_lng: number;
        trip_m: number;
        address_snapshot: unknown;
        earnings: number;
        tip_centavos: number;
        payment_method: string;
        total_centavos: number;
        expires_at: Date;
      }[]
    >`
      select d.id as offer_id, o.id as order_id, o.code, m.name as store_name,
             m.address_line as store_address,
             extensions.st_y(m.location::extensions.geometry) as pickup_lat,
             extensions.st_x(m.location::extensions.geometry) as pickup_lng,
             extensions.st_distance(m.location, o.dropoff) * 1.3 as trip_m,
             o.address_snapshot, d.rider_earnings_centavos as earnings, o.tip_centavos,
             o.payment_method::text as payment_method, o.total_centavos, d.expires_at
        from public.dispatch_offers d
        join public.orders o on o.id = d.order_id
        join public.merchants m on m.id = o.merchant_id
       where d.rider_id = ${riderId}::uuid and d.status = 'offered' and d.expires_at > ${now}
       order by d.offered_at desc
       limit 1`;
    if (!row) return null;
    return {
      offerId: row.offer_id,
      orderId: row.order_id,
      code: row.code,
      storeName: row.store_name,
      storeAddress: row.store_address,
      pickup: { lat: row.pickup_lat, lng: row.pickup_lng },
      tripMeters: Math.round(row.trip_m),
      dropoffArea: area(row.address_snapshot),
      earningsCentavos: row.earnings,
      tipCentavos: row.tip_centavos,
      cashToCollectCentavos: row.payment_method === "cod" ? row.total_centavos : 0,
      expiresAt: row.expires_at,
    };
  }

  async activeJob(riderId: string): Promise<RiderJob | null> {
    const [row] = await this.prisma.$queryRaw<
      {
        id: string;
        code: string;
        status: OrderStatus;
        arrived_store_at: Date | null;
        store_name: string;
        store_address: string | null;
        store_lat: number;
        store_lng: number;
        dropoff_lat: number;
        dropoff_lng: number;
        address_snapshot: unknown;
        payment_method: PaymentMethod;
        total_centavos: number;
        tip_centavos: number;
        rider_earnings_centavos: number | null;
        pin_required: boolean;
      }[]
    >`
      select o.id, o.code, o.status::text as status, o.arrived_store_at, m.name as store_name,
             m.address_line as store_address,
             extensions.st_y(m.location::extensions.geometry) as store_lat,
             extensions.st_x(m.location::extensions.geometry) as store_lng,
             extensions.st_y(o.dropoff::extensions.geometry) as dropoff_lat,
             extensions.st_x(o.dropoff::extensions.geometry) as dropoff_lng,
             o.address_snapshot, o.payment_method::text as payment_method, o.total_centavos,
             o.tip_centavos, o.rider_earnings_centavos,
             exists (select 1 from public.order_delivery_pins p where p.order_id = o.id) as pin_required
        from public.orders o join public.merchants m on m.id = o.merchant_id
       where o.rider_id = ${riderId}::uuid
         and o.status in ('accepted', 'preparing', 'ready', 'picked_up')
       order by o.accepted_at
       limit 1`;
    if (!row) return null;
    const items = await this.prisma.order_items.findMany({
      where: { order_id: row.id },
      select: { name_snapshot: true, quantity: true },
      orderBy: { created_at: "asc" },
    });
    const snap = row.address_snapshot;
    return {
      orderId: row.id,
      code: row.code,
      status: row.status,
      arrivedStoreAt: row.arrived_store_at,
      store: {
        name: row.store_name,
        address: row.store_address,
        location: { lat: row.store_lat, lng: row.store_lng },
      },
      dropoff: {
        location: { lat: row.dropoff_lat, lng: row.dropoff_lng },
        label: snapshotText(snap, "label"),
        street: snapshotText(snap, "street"),
        landmark: snapshotText(snap, "landmark"),
        barangay: area(snap),
        notes: snapshotText(snap, "notes"),
      },
      contactPhone: snapshotText(snap, "contact_phone"),
      paymentMethod: row.payment_method,
      totalCentavos: row.total_centavos,
      tipCentavos: row.tip_centavos,
      earningsCentavos: row.rider_earnings_centavos ?? 0,
      pinRequired: row.pin_required,
      items: items.map((item) => ({ name: item.name_snapshot, quantity: item.quantity })),
    };
  }

  async markArrivedAtStore(orderId: string, riderId: string, now: Date): Promise<boolean> {
    const updated = await this.prisma.orders.updateMany({
      where: { id: orderId, rider_id: riderId, status: { in: [...AWAITING] } },
      data: { arrived_store_at: now, dispatch_status: "at_store" },
    });
    return updated.count > 0;
  }

  async pickUp(orderId: string, riderId: string, riderUserId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await setActor(tx, riderUserId, "rider", {});
      const updated = await tx.orders.updateMany({
        where: { id: orderId, rider_id: riderId, status: "ready" },
        data: { status: "picked_up", dispatch_status: "picked_up" },
      });
      return updated.count > 0;
    });
  }

  async deliver(input: {
    readonly orderId: string;
    readonly riderId: string;
    readonly riderUserId: string;
    readonly proofPath: string | null;
    readonly ledger: LedgerTxn;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await setActor(tx, input.riderUserId, "rider", {
        proof: input.proofPath ? "photo" : "pin",
      });
      const updated = await tx.orders.updateMany({
        where: { id: input.orderId, rider_id: input.riderId, status: "picked_up" },
        data: { status: "delivered", delivery_proof_path: input.proofPath },
      });
      if (updated.count === 0) return false;
      await postLedger(tx, input.ledger);
      return true;
    });
  }

  async deliveryPin(orderId: string): Promise<string | null> {
    const row = await this.prisma.order_delivery_pins.findUnique({
      where: { order_id: orderId },
      select: { pin: true },
    });
    return row?.pin ?? null;
  }

  async settlementFacts(orderId: string): Promise<SettlementFacts | null> {
    const row = await this.prisma.orders.findUnique({
      where: { id: orderId },
      include: {
        merchants: { select: { commission_bps: true, founding_commission_until: true } },
        promo_redemptions: { include: { promos: { select: { funded_by: true } } } },
      },
    });
    if (!row) return null;
    return {
      orderId: row.id,
      customerId: row.customer_id,
      merchantId: row.merchant_id,
      paidOnline: row.payment_method !== "cod",
      subtotalCentavos: row.subtotal_centavos,
      deliveryFeeCentavos: row.delivery_fee_centavos,
      serviceFeeCentavos: row.service_fee_centavos,
      smallOrderFeeCentavos: row.small_order_fee_centavos,
      tipCentavos: row.tip_centavos,
      discountCentavos: row.discount_centavos,
      discountFundedBy:
        row.promo_redemptions?.promos.funded_by === "merchant" ? "merchant" : "platform",
      commissionBps: row.merchants.commission_bps,
      commissionFreeUntil: row.merchants.founding_commission_until,
      riderPayCentavos: row.rider_earnings_centavos ?? 0,
    };
  }

  async cashHeld(riderId: string): Promise<Centavos> {
    const [row] = await this.prisma.$queryRaw<{ balance: bigint | null }[]>`
      select coalesce(sum(debit_centavos - credit_centavos), 0) as balance
        from public.ledger_entries
       where account = 'rider_cash_on_hand' and party_id = ${riderId}::uuid`;
    return int(row?.balance);
  }

  async earningsSince(
    riderId: string,
    from: Date,
  ): Promise<{ jobs: number; payCentavos: Centavos; tipCentavos: Centavos }> {
    const totals = await this.prisma.orders.aggregate({
      where: { rider_id: riderId, status: "delivered", delivered_at: { gte: from } },
      _count: { _all: true },
      _sum: { rider_earnings_centavos: true, tip_centavos: true },
    });
    return {
      jobs: totals._count._all,
      payCentavos: totals._sum.rider_earnings_centavos ?? 0,
      tipCentavos: totals._sum.tip_centavos ?? 0,
    };
  }

  // --- ITrackingRepository --------------------------------------------------------------------

  async facts(orderId: string): Promise<TrackingFacts | null> {
    const [row] = await this.prisma.$queryRaw<
      {
        id: string;
        customer_id: string;
        merchant_id: string;
        zone_id: string;
        status: OrderStatus;
        store_lat: number;
        store_lng: number;
        dropoff_lat: number;
        dropoff_lng: number;
        ready_by: Date | null;
        rider_id: string | null;
        full_name: string | null;
        vehicle_type: VehicleType | null;
        plate_no: string | null;
        rider_lat: number | null;
        rider_lng: number | null;
        location_at: Date | null;
      }[]
    >`
      select o.id, o.customer_id, o.merchant_id, o.zone_id, o.status::text as status,
             extensions.st_y(m.location::extensions.geometry) as store_lat,
             extensions.st_x(m.location::extensions.geometry) as store_lng,
             extensions.st_y(o.dropoff::extensions.geometry) as dropoff_lat,
             extensions.st_x(o.dropoff::extensions.geometry) as dropoff_lng,
             case when o.accepted_at is not null and o.prep_minutes is not null
                  then o.accepted_at + make_interval(mins => o.prep_minutes) end as ready_by,
             o.rider_id, p.full_name, r.vehicle_type::text as vehicle_type, r.plate_no,
             extensions.st_y(l.location::extensions.geometry) as rider_lat,
             extensions.st_x(l.location::extensions.geometry) as rider_lng,
             l.updated_at as location_at
        from public.orders o
        join public.merchants m on m.id = o.merchant_id
        left join public.riders r on r.id = o.rider_id
        left join public.profiles p on p.id = r.user_id
        left join public.rider_locations l on l.rider_id = o.rider_id
       where o.id = ${orderId}::uuid`;
    if (!row) return null;
    return {
      orderId: row.id,
      customerId: row.customer_id,
      merchantId: row.merchant_id,
      zoneId: row.zone_id,
      status: row.status,
      store: { lat: row.store_lat, lng: row.store_lng },
      dropoff: { lat: row.dropoff_lat, lng: row.dropoff_lng },
      readyBy: row.ready_by,
      rider:
        row.rider_id && row.vehicle_type
          ? {
              firstName: row.full_name?.trim().split(/\s+/)[0] ?? null,
              vehicleType: row.vehicle_type,
              plateNo: row.plate_no,
              location: point(row.rider_lat, row.rider_lng),
              locationAt: row.location_at,
            }
          : null,
    };
  }
}
