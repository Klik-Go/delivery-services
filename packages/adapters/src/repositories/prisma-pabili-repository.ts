import {
  DEFAULT_PABILI_SETTINGS,
  type Centavos,
  type CreatePabiliResult,
  type IPabiliRepository,
  type IPabiliSettings,
  type NewPabiliOrder,
  type PabiliRecord,
  type PabiliSettings,
  type ZoneFees,
} from "@klikgo/core";
import type { PrismaClient } from "@klikgo/db";
import { PabiliRolloutSchema, type OrderStatus, type PabiliItemStatus } from "@klikgo/types";
import { setActor } from "./prisma-order-repository";

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return (text.includes("23505") || /unique/i.test(text)) && text.includes(constraint);
}

/** The `pabili` switch and its limits, cached briefly like the other switches. */
export class PrismaPabiliSettings implements IPabiliSettings {
  private cache: { at: number; value: PabiliSettings } | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly ttlMs = 10_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Drops the cache (an admin changed a flag on this server). */
  forget(): void {
    this.cache = null;
  }

  async current(): Promise<PabiliSettings> {
    if (this.cache && this.now() - this.cache.at <= this.ttlMs) return this.cache.value;
    const row = await this.prisma.feature_flags.findUnique({
      where: { key: "pabili" },
      select: { enabled: true, rollout: true },
    });
    const parsed = PabiliRolloutSchema.partial().safeParse(row?.rollout ?? {});
    const r = parsed.success ? parsed.data : {};
    const value: PabiliSettings = {
      enabled: row?.enabled ?? false,
      maxItemCentavos: r.max_item_centavos ?? DEFAULT_PABILI_SETTINGS.maxItemCentavos,
      serviceFeeCentavos: r.service_fee_centavos ?? DEFAULT_PABILI_SETTINGS.serviceFeeCentavos,
      maxItems: r.max_items ?? DEFAULT_PABILI_SETTINGS.maxItems,
      maxTripM: r.max_trip_m ?? DEFAULT_PABILI_SETTINGS.maxTripM,
    };
    this.cache = { at: this.now(), value };
    return value;
  }
}

interface RecordRow {
  order_id: string;
  code: string;
  customer_id: string;
  zone_id: string;
  rider_id: string | null;
  status: OrderStatus;
  store_name: string;
  store_notes: string | null;
  pickup_lat: number;
  pickup_lng: number;
  budget_centavos: number;
  delivery_fee_centavos: number;
  service_fee_centavos: number;
  total_centavos: number;
  item_cost_centavos: number | null;
  receipt_path: string | null;
  bought_at: Date | null;
  request_hash: string | null;
  created_at: Date;
}

/**
 * Pabili orders in Postgres: the order row (kind pabili, no store, cash), its request and the
 * shopping list. Status changes set the actor, so the database checks each transition and writes
 * order_events; the rider's steps are conditional on the order still being theirs and where they
 * saw it.
 */
export class PrismaPabiliRepository implements IPabiliRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async zoneFees(zoneId: string): Promise<ZoneFees | null> {
    const zone = await this.prisma.zones.findUnique({
      where: { id: zoneId },
      select: { base_fee_centavos: true, per_km_centavos: true, is_active: true },
    });
    if (!zone?.is_active) return null;
    const rules = await this.prisma.fee_rules.findMany({
      where: { zone_id: zoneId, is_active: true },
      orderBy: { priority: "desc" },
    });
    return {
      baseFeeCentavos: zone.base_fee_centavos,
      perKmCentavos: zone.per_km_centavos,
      rules: rules.map((rule) => ({
        kind: rule.kind,
        minDistanceM: rule.min_distance_m,
        maxDistanceM: rule.max_distance_m,
        minSubtotalCentavos: rule.min_subtotal_centavos,
        feeCentavos: rule.fee_centavos,
        priority: rule.priority,
      })),
    };
  }

  async create(order: NewPabiliOrder): Promise<CreatePabiliResult> {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await setActor(tx, order.customerId, "customer", { via: "pabili" });
        const address = {
          label: order.address.label,
          street: order.address.street ?? null,
          landmark: order.address.landmark,
          barangay: order.address.barangay ?? null,
          city: order.address.city ?? null,
          notes: order.address.notes ?? null,
          contact_phone: order.address.contactPhone,
        };
        const [row] = await tx.$queryRaw<{ id: string; code: string }[]>`
          insert into public.orders (
            customer_id, kind, merchant_id, zone_id, status, payment_method,
            subtotal_centavos, delivery_fee_centavos, service_fee_centavos, total_centavos,
            address_snapshot, dropoff, idempotency_key, request_hash)
          values (
            ${order.customerId}::uuid, 'pabili', null, ${order.zoneId}::uuid, 'placed', 'cod',
            0, ${order.deliveryFeeCentavos}, ${order.serviceFeeCentavos}, ${order.totalCentavos},
            ${JSON.stringify(address)}::jsonb,
            extensions.st_setsrid(extensions.st_makepoint(${order.dropoff.lng}, ${order.dropoff.lat}), 4326)::extensions.geography,
            ${order.idempotencyKey}, ${order.requestHash})
          returning id, code`;
        if (!row) throw new Error("insert into orders returned no row");
        await tx.$executeRaw`
          insert into public.pabili_requests (order_id, store_name, store_notes, pickup, budget_centavos)
          values (${row.id}::uuid, ${order.storeName}, ${order.storeNotes},
                  extensions.st_setsrid(extensions.st_makepoint(${order.pickup.lng}, ${order.pickup.lat}), 4326)::extensions.geography,
                  ${order.budgetCentavos})`;
        await tx.pabili_items.createMany({
          data: order.lines.map((line) => ({
            order_id: row.id,
            position: line.position,
            description: line.description,
            quantity: line.quantity,
            note: line.note,
          })),
        });
        // No store has to confirm: Klik Go takes the order in the same transaction.
        await setActor(tx, null, null, { by: "system", reason: "pabili" });
        await tx.orders.update({ where: { id: row.id }, data: { status: "accepted" } });
        return row;
      });
      return { kind: "created", id: created.id, code: created.code };
    } catch (error) {
      if (isUniqueViolation(error, "orders_customer_idempotency_key")) return { kind: "duplicate" };
      throw error;
    }
  }

  async findByIdempotencyKey(customerId: string, key: string): Promise<PabiliRecord | null> {
    const order = await this.prisma.orders.findFirst({
      where: { customer_id: customerId, idempotency_key: key, kind: "pabili" },
      select: { id: true },
    });
    return order ? this.find(order.id) : null;
  }

  async find(orderId: string): Promise<PabiliRecord | null> {
    const [row] = await this.prisma.$queryRaw<RecordRow[]>`
      select o.id as order_id, o.code, o.customer_id, o.zone_id, o.rider_id, o.status::text as status,
             p.store_name, p.store_notes,
             extensions.st_y(p.pickup::extensions.geometry) as pickup_lat,
             extensions.st_x(p.pickup::extensions.geometry) as pickup_lng,
             p.budget_centavos, o.delivery_fee_centavos, o.service_fee_centavos, o.total_centavos,
             p.item_cost_centavos, p.receipt_path, p.bought_at, o.request_hash, o.created_at
        from public.orders o join public.pabili_requests p on p.order_id = o.id
       where o.id = ${orderId}::uuid and o.kind = 'pabili'`;
    if (!row) return null;
    const lines = await this.prisma.pabili_items.findMany({
      where: { order_id: orderId },
      orderBy: { position: "asc" },
    });
    return {
      orderId: row.order_id,
      code: row.code,
      customerId: row.customer_id,
      zoneId: row.zone_id,
      riderId: row.rider_id,
      status: row.status,
      storeName: row.store_name,
      storeNotes: row.store_notes,
      pickup: { lat: row.pickup_lat, lng: row.pickup_lng },
      budgetCentavos: row.budget_centavos,
      deliveryFeeCentavos: row.delivery_fee_centavos,
      serviceFeeCentavos: row.service_fee_centavos,
      totalCentavos: row.total_centavos,
      itemCostCentavos: row.item_cost_centavos,
      receiptPath: row.receipt_path,
      boughtAt: row.bought_at,
      requestHash: row.request_hash,
      createdAt: row.created_at,
      lines: lines.map((line) => ({
        position: line.position,
        description: line.description,
        quantity: line.quantity,
        note: line.note,
        status: line.status,
      })),
    };
  }

  async startShopping(input: {
    readonly orderId: string;
    readonly riderId: string;
    readonly riderUserId: string;
    readonly now: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await setActor(tx, input.riderUserId, "rider", { step: "shopping" });
      const updated = await tx.orders.updateMany({
        where: { id: input.orderId, kind: "pabili", rider_id: input.riderId, status: "accepted" },
        data: { status: "preparing", arrived_store_at: input.now, dispatch_status: "at_store" },
      });
      return updated.count > 0;
    });
  }

  async recordPurchase(input: {
    readonly orderId: string;
    readonly riderId: string;
    readonly riderUserId: string;
    readonly itemCostCentavos: Centavos;
    readonly receiptPath: string;
    readonly lines: readonly { readonly position: number; readonly status: PabiliItemStatus }[];
    readonly now: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await setActor(tx, input.riderUserId, "rider", {
        step: "bought",
        itemCostCentavos: input.itemCostCentavos,
      });
      const updated = await tx.orders.updateMany({
        where: { id: input.orderId, kind: "pabili", rider_id: input.riderId, status: "preparing" },
        data: { status: "ready" },
      });
      if (updated.count === 0) return false;
      // The database refuses a cost above the budget (pabili_requests_within_budget).
      await tx.pabili_requests.update({
        where: { order_id: input.orderId },
        data: {
          item_cost_centavos: input.itemCostCentavos,
          receipt_path: input.receiptPath,
          bought_at: input.now,
        },
      });
      for (const line of input.lines) {
        await tx.pabili_items.updateMany({
          where: { order_id: input.orderId, position: line.position },
          data: { status: line.status },
        });
      }
      return true;
    });
  }

  async setFloat(riderId: string, floatCentavos: Centavos): Promise<void> {
    await this.prisma.riders.update({
      where: { id: riderId },
      data: { pabili_float_centavos: floatCentavos },
    });
  }
}
