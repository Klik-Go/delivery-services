import { randomUUID } from "node:crypto";
import type {
  BoardOrder,
  Centavos,
  IOrderLifecycleRepository,
  IOrderRepository,
  IPaymentRepository,
  LedgerTxn,
  NewOrder,
  NewPayment,
  OrderRecord,
  PaymentRecord,
  StatusChangeRequest,
} from "@klikgo/core";
import type { PrismaClient } from "@klikgo/db";
import type { OrderStatus, PaymentMethod, PaymentStatus, RefundStatus } from "@klikgo/types";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

interface PaymentRow {
  id: string;
  order_id: string;
  gateway: string;
  intent_id: string;
  method: string;
  amount_centavos: number;
  status: string;
  checkout_url: string | null;
  gateway_payment_id: string | null;
  fee_centavos: number | null;
  refunded_centavos: number;
}

interface OrderRow {
  id: string;
  code: string;
  customer_id: string;
  merchant_id: string;
  merchants: { name: string };
  zone_id: string;
  prep_minutes: number | null;
  reject_reason: string | null;
  cancel_reason: string | null;
  accepted_at: Date | null;
  placed_at: Date | null;
  preparing_at: Date | null;
  ready_at: Date | null;
  picked_up_at: Date | null;
  delivered_at: Date | null;
  rejected_at: Date | null;
  cancelled_at: Date | null;
  status: string;
  payment_method: string;
  payment_status: string;
  total_centavos: number;
  request_hash: string | null;
  created_at: Date;
  payments: PaymentRow | null;
}

const toPayment = (row: PaymentRow): PaymentRecord => ({
  id: row.id,
  orderId: row.order_id,
  gateway: row.gateway,
  intentId: row.intent_id,
  method: row.method as PaymentMethod,
  amountCentavos: row.amount_centavos,
  status: row.status as PaymentStatus,
  checkoutUrl: row.checkout_url,
  gatewayPaymentId: row.gateway_payment_id,
  feeCentavos: row.fee_centavos,
  refundedCentavos: row.refunded_centavos,
});

const toOrder = (row: OrderRow): OrderRecord => ({
  id: row.id,
  code: row.code,
  customerId: row.customer_id,
  merchantId: row.merchant_id,
  merchantName: row.merchants.name,
  zoneId: row.zone_id,
  // The default prep time is copied at checkout; the store's own number counts once it accepts.
  prepMinutes: row.accepted_at ? row.prep_minutes : null,
  rejectReason: row.reject_reason,
  cancelReason: row.cancel_reason,
  timeline: {
    placedAt: row.placed_at,
    acceptedAt: row.accepted_at,
    preparingAt: row.preparing_at,
    readyAt: row.ready_at,
    pickedUpAt: row.picked_up_at,
    deliveredAt: row.delivered_at,
    rejectedAt: row.rejected_at,
    cancelledAt: row.cancelled_at,
  },
  status: row.status as OrderStatus,
  paymentMethod: row.payment_method as PaymentMethod,
  paymentStatus: row.payment_status as PaymentStatus,
  totalCentavos: row.total_centavos,
  requestHash: row.request_hash,
  createdAt: row.created_at,
  payment: row.payments ? toPayment(row.payments) : null,
});

const ORDER_INCLUDE = { payments: true, merchants: { select: { name: true } } } as const;

/** True when a database error is a unique violation of `constraint`. */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return (text.includes("23505") || /unique/i.test(text)) && text.includes(constraint);
}

/** Order status changes record who made them (orders_log_status reads these settings). */
async function setActor(
  tx: Tx,
  actorId: string | null,
  role: string | null,
  meta: Record<string, unknown>,
): Promise<void> {
  await tx.$queryRaw`
    select set_config('klikgo.actor_id', ${actorId ?? ""}, true),
           set_config('klikgo.actor_role', ${role ?? ""}, true),
           set_config('klikgo.event_meta', ${JSON.stringify(meta)}, true)`;
}

async function postLedger(tx: Tx, txn: LedgerTxn): Promise<void> {
  const txnId = randomUUID();
  // The deferred ledger_entries_balanced trigger checks debits = credits when this commits.
  await tx.ledger_entries.createMany({
    data: txn.lines.map((line) => ({
      txn_id: txnId,
      account: line.account,
      party_type: line.partyType,
      party_id: line.partyId,
      debit_centavos: line.debitCentavos,
      credit_centavos: line.creditCentavos,
      order_id: txn.orderId,
      memo: line.memo,
    })),
  });
}

/**
 * Orders, payments, refunds and their ledger postings in Postgres. Every method that changes
 * money runs in one transaction; order status changes go through the database's transition guard
 * and leave an order_events row with the actor.
 */
export class PrismaOrderRepository
  implements IOrderRepository, IPaymentRepository, IOrderLifecycleRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findById(orderId: string): Promise<OrderRecord | null> {
    const row = await this.prisma.orders.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    });
    return row ? toOrder(row) : null;
  }

  async findByIdempotencyKey(customerId: string, key: string): Promise<OrderRecord | null> {
    const row = await this.prisma.orders.findFirst({
      where: { customer_id: customerId, idempotency_key: key },
      include: ORDER_INCLUDE,
    });
    return row ? toOrder(row) : null;
  }

  async create(order: NewOrder): Promise<{ id: string; code: string } | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await setActor(tx, order.customerId, "customer", { via: "checkout" });
        const address = {
          label: order.address.label,
          street: order.address.street ?? null,
          landmark: order.address.landmark,
          barangay: order.address.barangay ?? null,
          city: order.address.city ?? null,
          notes: order.address.notes ?? null,
          contact_phone: order.address.contactPhone,
        };
        const [created] = await tx.$queryRaw<{ id: string; code: string }[]>`
          insert into public.orders (
            customer_id, merchant_id, zone_id, status, payment_method,
            subtotal_centavos, delivery_fee_centavos, service_fee_centavos, small_order_fee_centavos,
            discount_centavos, tip_centavos, total_centavos, address_snapshot, dropoff,
            scheduled_for, prep_minutes, idempotency_key, request_hash)
          values (
            ${order.customerId}::uuid, ${order.merchantId}::uuid, ${order.zoneId}::uuid,
            ${order.status}::public.order_status, ${order.paymentMethod}::public.payment_method,
            ${order.subtotalCentavos}, ${order.deliveryFeeCentavos}, ${order.serviceFeeCentavos},
            ${order.smallOrderFeeCentavos}, ${order.discountCentavos}, ${order.tipCentavos},
            ${order.totalCentavos}, ${JSON.stringify(address)}::jsonb,
            extensions.st_setsrid(extensions.st_makepoint(${order.dropoff.lng}, ${order.dropoff.lat}), 4326)::extensions.geography,
            ${order.scheduledFor}, ${order.prepMinutes}, ${order.idempotencyKey}, ${order.requestHash})
          returning id, code`;
        if (!created) throw new Error("insert into orders returned no row");
        await tx.order_items.createMany({
          data: order.lines.map((line) => ({
            order_id: created.id,
            menu_item_id: line.menuItemId,
            name_snapshot: line.name,
            unit_price_centavos: line.basePriceCentavos,
            modifiers_unit_centavos: line.modifiersUnitCentavos,
            quantity: line.quantity,
            modifiers_snapshot: line.modifiers.map((m) => ({ id: m.id, name: m.name })),
            line_total_centavos: line.lineTotalCentavos,
          })),
        });
        if (order.promo) {
          await tx.promo_redemptions.create({
            data: {
              promo_id: order.promo.promoId,
              user_id: order.customerId,
              order_id: created.id,
              discount_centavos: order.promo.discountCentavos,
            },
          });
        }
        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error, "orders_customer_idempotency_key")) return null;
      throw error;
    }
  }

  async attachPayment(orderId: string, payment: NewPayment): Promise<void> {
    await this.prisma.payments.create({
      data: {
        order_id: orderId,
        gateway: payment.gateway,
        intent_id: payment.intentId,
        method: payment.method,
        amount_centavos: payment.amountCentavos,
        checkout_url: payment.checkoutUrl,
      },
    });
  }

  async findByIntent(
    gateway: string,
    intentId: string,
  ): Promise<{ payment: PaymentRecord; order: OrderRecord } | null> {
    const row = await this.prisma.payments.findUnique({
      where: { gateway_intent_id: { gateway, intent_id: intentId } },
      include: { orders: { include: ORDER_INCLUDE } },
    });
    return row ? { payment: toPayment(row), order: toOrder(row.orders) } : null;
  }

  async recordCapture(input: {
    paymentId: string;
    orderId: string;
    gatewayPaymentId: string;
    feeCentavos: Centavos;
    paidAt: Date;
    ledger: LedgerTxn;
  }): Promise<{ alreadyPaid: boolean; orderStatus: OrderStatus }> {
    return this.prisma.$transaction(async (tx) => {
      const captured = await tx.$queryRaw<{ id: string }[]>`
        update public.payments
           set status = 'paid', gateway_payment_id = ${input.gatewayPaymentId},
               fee_centavos = ${input.feeCentavos}, paid_at = ${input.paidAt}
         where id = ${input.paymentId}::uuid and status in ('pending', 'processing', 'failed')
        returning id`;
      if (captured.length > 0) {
        await setActor(tx, null, null, { by: "system", reason: "payment_confirmed" });
        // Conditional: an order the unpaid timeout already cancelled stays cancelled.
        await tx.$queryRaw`
          update public.orders set status = 'placed'
           where id = ${input.orderId}::uuid and status = 'awaiting_payment'
          returning id`;
        await tx.orders.update({ where: { id: input.orderId }, data: { payment_status: "paid" } });
        await postLedger(tx, input.ledger);
      }
      const order = await tx.orders.findUniqueOrThrow({
        where: { id: input.orderId },
        select: { status: true },
      });
      return { alreadyPaid: captured.length === 0, orderStatus: order.status };
    });
  }

  async recordFailure(paymentId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const failed = await tx.$queryRaw<{ order_id: string }[]>`
        update public.payments set status = 'failed'
         where id = ${paymentId}::uuid and status in ('pending', 'processing')
        returning order_id`;
      const orderId = failed[0]?.order_id;
      if (orderId) {
        await tx.orders.updateMany({
          where: { id: orderId, payment_status: { in: ["pending", "processing"] } },
          data: { payment_status: "failed" },
        });
      }
    });
  }

  async depositBalance(orderId: string): Promise<Centavos> {
    const [row] = await this.prisma.$queryRaw<{ balance: bigint | null }[]>`
      select sum(credit_centavos - debit_centavos) as balance
        from public.ledger_entries
       where order_id = ${orderId}::uuid and account = 'customer_deposits'`;
    return Number(row?.balance ?? 0);
  }

  async reserveRefund(input: {
    paymentId: string;
    orderId: string;
    amountCentavos: Centavos;
    reason: string;
    requestedBy: string | null;
  }): Promise<{ refundId: string } | null> {
    return this.prisma.$transaction(async (tx) => {
      const reserved = await tx.$queryRaw<{ id: string }[]>`
        update public.payments set refunded_centavos = refunded_centavos + ${input.amountCentavos}
         where id = ${input.paymentId}::uuid
           and refunded_centavos + ${input.amountCentavos} <= amount_centavos
        returning id`;
      if (reserved.length === 0) return null;
      const refund = await tx.refunds.create({
        data: {
          order_id: input.orderId,
          payment_id: input.paymentId,
          amount_centavos: input.amountCentavos,
          reason: input.reason,
          requested_by: input.requestedBy,
        },
        select: { id: true },
      });
      return { refundId: refund.id };
    });
  }

  async completeRefund(input: {
    refundId: string;
    paymentId: string;
    gatewayRef: string;
    status: "pending" | "succeeded";
    ledger: LedgerTxn;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.refunds.update({
        where: { id: input.refundId },
        data: { gateway_ref: input.gatewayRef, status: input.status },
      });
      const [payment] = await tx.$queryRaw<{ order_id: string; status: string }[]>`
        update public.payments
           set status = case when refunded_centavos >= amount_centavos then 'refunded'
                             else 'partially_refunded' end::public.payment_status
         where id = ${input.paymentId}::uuid
        returning order_id, status::text`;
      if (payment) {
        await tx.orders.update({
          where: { id: payment.order_id },
          data: { payment_status: payment.status as PaymentStatus },
        });
      }
      await postLedger(tx, input.ledger);
    });
  }

  async failRefund(input: {
    refundId: string;
    paymentId: string;
    amountCentavos: Centavos;
  }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.refunds.update({ where: { id: input.refundId }, data: { status: "failed" } }),
      this.prisma.payments.update({
        where: { id: input.paymentId },
        data: { refunded_centavos: { decrement: input.amountCentavos } },
      }),
    ]);
  }

  async updateRefundStatus(gatewayRef: string, status: RefundStatus): Promise<boolean> {
    const updated = await this.prisma.refunds.updateMany({
      where: { gateway_ref: gatewayRef },
      data: { status },
    });
    return updated.count > 0;
  }

  async changeStatus(request: StatusChangeRequest): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await setActor(tx, request.actor.id, request.actor.role, request.meta);
      // Lock the row and check it is still where the caller saw it, so two staff (or two taps)
      // cannot both win; the database's guard validates each step and writes order_events.
      const locked = await tx.$queryRaw<{ status: string }[]>`
        select status::text from public.orders where id = ${request.orderId}::uuid for update`;
      if (locked[0]?.status !== request.from) return false;
      for (const step of request.steps) {
        await tx.orders.update({
          where: { id: request.orderId },
          data: {
            status: step,
            ...(step === "accepted" && request.prepMinutes !== undefined
              ? { prep_minutes: request.prepMinutes }
              : {}),
            ...(step === "rejected" && request.rejectReason !== undefined
              ? { reject_reason: request.rejectReason }
              : {}),
            ...(step === "cancelled"
              ? {
                  cancel_reason: request.cancelReason ?? "Cancelled",
                  cancelled_by_role: request.actor.role,
                }
              : {}),
          },
        });
      }
      if (request.releasePromo) {
        await tx.promo_redemptions.deleteMany({ where: { order_id: request.orderId } });
      }
      return true;
    });
  }

  async board(merchantId: string): Promise<BoardOrder[]> {
    const rows = await this.prisma.orders.findMany({
      where: {
        merchant_id: merchantId,
        status: { in: ["placed", "accepted", "preparing", "ready", "picked_up"] },
      },
      include: { order_items: { orderBy: { created_at: "asc" } } },
      orderBy: { placed_at: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      status: row.status,
      paymentMethod: row.payment_method,
      paymentStatus: row.payment_status,
      totalCentavos: row.total_centavos,
      placedAt: row.placed_at ?? row.created_at,
      acceptedAt: row.accepted_at,
      prepMinutes: row.accepted_at ? row.prep_minutes : null,
      scheduledFor: row.scheduled_for,
      flaggedAt: row.sla_flagged_at,
      notes: noteOf(row.address_snapshot),
      items: row.order_items.map((item) => ({
        menuItemId: item.menu_item_id,
        name: item.name_snapshot,
        quantity: item.quantity,
        modifiers: modifierNames(item.modifiers_snapshot),
      })),
    }));
  }

  async refundsDue(limit: number): Promise<{ orderId: string; reason: string }[]> {
    const rows = await this.prisma.orders.findMany({
      where: {
        status: { in: ["cancelled", "rejected"] },
        payments: { status: "paid" },
      },
      select: { id: true, reject_reason: true, cancel_reason: true },
      orderBy: { updated_at: "asc" },
      take: limit,
    });
    return rows.map((row) => ({
      orderId: row.id,
      reason: reasonText(row.reject_reason ?? row.cancel_reason),
    }));
  }
}

/** Words for the system's cancel codes, for refund notes. */
function reasonText(reason: string | null): string {
  if (reason === "merchant_timeout") return "The store did not confirm the order in time";
  if (reason === "payment_timeout") return "Paid after the order was cancelled";
  return reason ?? "Order ended early";
}

function noteOf(snapshot: unknown): string | null {
  if (typeof snapshot !== "object" || snapshot === null) return null;
  const notes = (snapshot as Record<string, unknown>).notes;
  return typeof notes === "string" && notes.trim() !== "" ? notes : null;
}

function modifierNames(snapshot: unknown): string[] {
  if (!Array.isArray(snapshot)) return [];
  return snapshot
    .map((m: unknown) =>
      typeof m === "object" && m !== null ? (m as Record<string, unknown>).name : undefined,
    )
    .filter((name): name is string => typeof name === "string");
}
