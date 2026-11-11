import type { OrderStatus, PaymentMethod, VehicleType } from "@klikgo/types";
import { roadMeters, haversineMeters } from "../catalog/geo";
import type { INotifiableOrders, IMessageSender } from "../dispatch/dispatch-service";
import {
  DEFAULT_DISPATCH_SETTINGS,
  type DispatchJob,
  type DispatchSettings,
  type IDeliveryProofStorage,
  type IDispatchRepository,
  type IDispatchSettingsSource,
  type IRiderRepository,
  type ITrackingRepository,
  type OfferAnswer,
  type RiderCandidate,
  type RiderJob,
  type RiderOffer,
  type RiderProfile,
  type SettlementFacts,
  type TrackingFacts,
} from "../dispatch/ports";
import type { GeoPoint } from "../merchant/ports";
import type { NotifiableOrder } from "../notifications/notification-service";
import type { NotificationMessage } from "../notifications/ports";
import type { LedgerTxn } from "../ordering/ports";
import type { Centavos } from "../shared/money";

export interface FakeRider {
  id: string;
  userId: string;
  zoneId: string;
  status: RiderProfile["status"];
  isOnline: boolean;
  fullName: string | null;
  vehicleType: VehicleType;
  plateNo: string | null;
  cashLimitCentavos: Centavos;
  /** COD cash collected before this test (remittances are Phase 10). */
  cashHeldCentavos: Centavos;
  location: GeoPoint | null;
  locationAt: Date | null;
}

export interface FakeDeliveryOrder {
  id: string;
  code: string;
  customerId: string;
  merchantId: string;
  merchantName: string;
  storeAddress: string | null;
  zoneId: string;
  status: OrderStatus;
  riderId: string | null;
  paymentMethod: PaymentMethod;
  paidOnline: boolean;
  subtotalCentavos: Centavos;
  deliveryFeeCentavos: Centavos;
  serviceFeeCentavos: Centavos;
  smallOrderFeeCentavos: Centavos;
  tipCentavos: Centavos;
  discountCentavos: Centavos;
  discountFundedBy: "platform" | "merchant";
  totalCentavos: Centavos;
  commissionBps: number;
  commissionFreeUntil: Date | null;
  pickup: GeoPoint;
  dropoff: GeoPoint;
  dropoffBarangay: string | null;
  landmark: string | null;
  contactPhone: string | null;
  attempts: number;
  flaggedAt: Date | null;
  readyBy: Date | null;
  arrivedStoreAt: Date | null;
  earningsCentavos: Centavos | null;
  pin: string | null;
  proofPath: string | null;
  deliveredAt: Date | null;
}

export interface FakeOffer {
  readonly id: string;
  readonly orderId: string;
  readonly riderId: string;
  status: "offered" | "accepted" | "declined" | "expired";
  readonly expiresAt: Date;
  readonly earningsCentavos: Centavos;
}

const ACTIVE: readonly OrderStatus[] = ["accepted", "preparing", "ready", "picked_up"];
const AWAITING: readonly OrderStatus[] = ["accepted", "preparing", "ready"];

/**
 * Riders, orders and offers in memory, with the same rules as the SQL behind the Prisma
 * repositories (nearest_available_riders, conditional offers and status changes, settlement in
 * one step). One object plays every dispatch port so tests see one consistent world.
 */
export class InMemoryDispatch
  implements
    IDispatchRepository,
    IRiderRepository,
    ITrackingRepository,
    IDeliveryProofStorage,
    IDispatchSettingsSource,
    INotifiableOrders
{
  readonly riders: FakeRider[] = [];
  readonly orders: FakeDeliveryOrder[] = [];
  readonly offers: FakeOffer[] = [];
  readonly breadcrumbs: { riderId: string; orderId: string; point: GeoPoint }[] = [];
  readonly ledger: LedgerTxn[] = [];
  readonly photos: { path: string; bytes: number }[] = [];
  settings: DispatchSettings = DEFAULT_DISPATCH_SETTINGS;
  private sequence = 0;

  constructor(private readonly now: () => Date) {}

  // --- seeding --------------------------------------------------------------------------------

  addRider(rider: Partial<FakeRider> & Pick<FakeRider, "id">): FakeRider {
    const row: FakeRider = {
      userId: `user-${rider.id}`,
      zoneId: "makati",
      status: "active",
      isOnline: true,
      fullName: `${rider.id} Rider`,
      vehicleType: "motorcycle",
      plateNo: "ABC 1234",
      cashLimitCentavos: 300_000,
      cashHeldCentavos: 0,
      location: null,
      locationAt: null,
      ...rider,
    };
    if (row.location && !row.locationAt) row.locationAt = this.now();
    this.riders.push(row);
    return row;
  }

  addOrder(order: Partial<FakeDeliveryOrder> & Pick<FakeDeliveryOrder, "id">): FakeDeliveryOrder {
    const row: FakeDeliveryOrder = {
      code: `KG-${order.id}`,
      customerId: "customer-1",
      merchantId: "kape",
      merchantName: "Kape't Tinapay",
      storeAddress: "Legazpi Village",
      zoneId: "makati",
      status: "preparing",
      riderId: null,
      paymentMethod: "cod",
      paidOnline: false,
      subtotalCentavos: 19_000,
      deliveryFeeCentavos: 4_900,
      serviceFeeCentavos: 0,
      smallOrderFeeCentavos: 0,
      tipCentavos: 0,
      discountCentavos: 0,
      discountFundedBy: "platform",
      totalCentavos: 23_900,
      commissionBps: 1500,
      commissionFreeUntil: null,
      pickup: { lat: 14.5583, lng: 121.0187 },
      dropoff: { lat: 14.5547, lng: 121.0244 },
      dropoffBarangay: "Bel-Air",
      landmark: "Lobby of the blue tower",
      contactPhone: "+639171234567",
      attempts: 0,
      flaggedAt: null,
      readyBy: null,
      arrivedStoreAt: null,
      earningsCentavos: null,
      pin: null,
      proofPath: null,
      deliveredAt: null,
      ...order,
    };
    this.orders.push(row);
    return row;
  }

  order(id: string): FakeDeliveryOrder {
    const row = this.orders.find((o) => o.id === id);
    if (!row) throw new Error(`No order ${id}`);
    return row;
  }

  rider(id: string): FakeRider {
    const row = this.riders.find((r) => r.id === id);
    if (!row) throw new Error(`No rider ${id}`);
    return row;
  }

  // --- settings and notifiable orders ---------------------------------------------------------

  load(): Promise<DispatchSettings> {
    return Promise.resolve(this.settings);
  }

  findById(orderId: string): Promise<NotifiableOrder | null> {
    const o = this.orders.find((row) => row.id === orderId);
    return Promise.resolve(
      o
        ? {
            id: o.id,
            code: o.code,
            customerId: o.customerId,
            merchantId: o.merchantId,
            merchantName: o.merchantName,
            totalCentavos: o.totalCentavos,
          }
        : null,
    );
  }

  // --- IDispatchRepository --------------------------------------------------------------------

  job(orderId: string): Promise<DispatchJob | null> {
    const o = this.orders.find((row) => row.id === orderId);
    if (!o) return Promise.resolve(null);
    return Promise.resolve({
      id: o.id,
      code: o.code,
      zoneId: o.zoneId,
      merchantName: o.merchantName,
      status: o.status,
      riderId: o.riderId,
      paymentMethod: o.paymentMethod,
      totalCentavos: o.totalCentavos,
      pickup: o.pickup,
      dropoff: o.dropoff,
      attempts: o.attempts,
      flaggedAt: o.flaggedAt,
      readyBy: o.readyBy,
      hasOpenOffer: this.offers.some((f) => f.orderId === o.id && f.status === "offered"),
    });
  }

  candidates(job: DispatchJob, maxDistanceM: number): Promise<RiderCandidate[]> {
    const now = this.now().getTime();
    const list = this.riders
      .filter(
        (r) =>
          r.status === "active" &&
          r.isOnline &&
          r.zoneId === job.zoneId &&
          r.location !== null &&
          r.locationAt !== null &&
          now - r.locationAt.getTime() <= 120_000 &&
          !this.orders.some((o) => o.riderId === r.id && ACTIVE.includes(o.status)) &&
          !this.offers.some(
            (f) => f.riderId === r.id && (f.orderId === job.id || f.status === "offered"),
          ),
      )
      .map((r) => ({
        riderId: r.id,
        userId: r.userId,
        distanceM: haversineMeters(r.location ?? job.pickup, job.pickup),
        cashHeldCentavos: this.cashHeldSync(r.id),
        cashLimitCentavos: r.cashLimitCentavos,
      }))
      .filter((c) => c.distanceM <= maxDistanceM)
      .sort((a, b) => a.distanceM - b.distanceM);
    return Promise.resolve(list);
  }

  createOffer(input: {
    readonly orderId: string;
    readonly riderId: string;
    readonly earningsCentavos: Centavos;
    readonly expiresAt: Date;
  }): Promise<string | null> {
    const o = this.order(input.orderId);
    const open = this.offers.some((f) => f.orderId === o.id && f.status === "offered");
    const repeat = this.offers.some((f) => f.orderId === o.id && f.riderId === input.riderId);
    if (o.riderId || open || repeat) return Promise.resolve(null);
    this.sequence += 1;
    const id = `offer-${String(this.sequence)}`;
    this.offers.push({ id, ...input, status: "offered" });
    o.attempts += 1;
    return Promise.resolve(id);
  }

  expireDue(now: Date): Promise<string[]> {
    const due = this.offers.filter((f) => f.status === "offered" && f.expiresAt <= now);
    for (const f of due) f.status = "expired";
    return Promise.resolve(due.map((f) => f.orderId));
  }

  awaitingDispatch(): Promise<string[]> {
    return Promise.resolve(
      this.orders
        .filter(
          (o) =>
            AWAITING.includes(o.status) &&
            !o.riderId &&
            !this.offers.some((f) => f.orderId === o.id && f.status === "offered"),
        )
        .map((o) => o.id),
    );
  }

  flag(orderId: string, now: Date): Promise<boolean> {
    const o = this.order(orderId);
    if (o.flaggedAt) return Promise.resolve(false);
    o.flaggedAt = now;
    return Promise.resolve(true);
  }

  respond(input: {
    readonly offerId: string;
    readonly riderId: string;
    readonly answer: OfferAnswer;
    readonly now: Date;
  }): Promise<{ readonly orderId: string } | "not_found" | "closed"> {
    const f = this.offers.find((row) => row.id === input.offerId && row.riderId === input.riderId);
    if (!f) return Promise.resolve("not_found");
    if (f.status !== "offered" || f.expiresAt <= input.now) return Promise.resolve("closed");
    const o = this.order(f.orderId);
    if (input.answer === "accepted" && (o.riderId || !AWAITING.includes(o.status))) {
      f.status = "expired";
      return Promise.resolve("closed");
    }
    f.status = input.answer;
    if (input.answer === "accepted") {
      o.riderId = f.riderId;
      o.earningsCentavos = f.earningsCentavos;
    }
    return Promise.resolve({ orderId: o.id });
  }

  // --- IRiderRepository -----------------------------------------------------------------------

  riderForUser(userId: string): Promise<RiderProfile | null> {
    const r = this.riders.find((row) => row.userId === userId);
    return Promise.resolve(
      r
        ? {
            id: r.id,
            userId: r.userId,
            zoneId: r.zoneId,
            status: r.status,
            isOnline: r.isOnline,
            fullName: r.fullName,
            vehicleType: r.vehicleType,
            plateNo: r.plateNo,
            cashLimitCentavos: r.cashLimitCentavos,
          }
        : null,
    );
  }

  setOnline(riderId: string, online: boolean): Promise<void> {
    this.rider(riderId).isOnline = online;
    return Promise.resolve();
  }

  saveLocation(
    riderId: string,
    point: GeoPoint,
    now: Date,
    minIntervalMs: number,
  ): Promise<boolean> {
    const r = this.rider(riderId);
    if (r.locationAt && now.getTime() - r.locationAt.getTime() < minIntervalMs) {
      return Promise.resolve(false);
    }
    r.location = { lat: point.lat, lng: point.lng };
    r.locationAt = now;
    return Promise.resolve(true);
  }

  addBreadcrumb(riderId: string, orderId: string, point: GeoPoint): Promise<void> {
    this.breadcrumbs.push({ riderId, orderId, point: { lat: point.lat, lng: point.lng } });
    return Promise.resolve();
  }

  currentOffer(riderId: string, now: Date): Promise<RiderOffer | null> {
    const f = this.offers.find(
      (row) => row.riderId === riderId && row.status === "offered" && row.expiresAt > now,
    );
    if (!f) return Promise.resolve(null);
    const o = this.order(f.orderId);
    return Promise.resolve({
      offerId: f.id,
      orderId: o.id,
      code: o.code,
      storeName: o.merchantName,
      storeAddress: o.storeAddress,
      pickup: o.pickup,
      tripMeters: roadMeters(o.pickup, o.dropoff),
      dropoffArea: o.dropoffBarangay,
      earningsCentavos: f.earningsCentavos,
      tipCentavos: o.tipCentavos,
      cashToCollectCentavos: o.paymentMethod === "cod" ? o.totalCentavos : 0,
      expiresAt: f.expiresAt,
    });
  }

  activeJob(riderId: string): Promise<RiderJob | null> {
    const o = this.orders.find((row) => row.riderId === riderId && ACTIVE.includes(row.status));
    if (!o) return Promise.resolve(null);
    return Promise.resolve({
      orderId: o.id,
      code: o.code,
      status: o.status,
      arrivedStoreAt: o.arrivedStoreAt,
      store: { name: o.merchantName, address: o.storeAddress, location: o.pickup },
      dropoff: {
        location: o.dropoff,
        label: "Office",
        street: null,
        landmark: o.landmark,
        barangay: o.dropoffBarangay,
        notes: null,
      },
      contactPhone: o.contactPhone,
      paymentMethod: o.paymentMethod,
      totalCentavos: o.totalCentavos,
      tipCentavos: o.tipCentavos,
      earningsCentavos: o.earningsCentavos ?? 0,
      pinRequired: o.pin !== null,
      items: [{ name: "Kapeng Barako", quantity: 2 }],
    });
  }

  markArrivedAtStore(orderId: string, riderId: string, now: Date): Promise<boolean> {
    const o = this.order(orderId);
    if (o.riderId !== riderId || !AWAITING.includes(o.status)) return Promise.resolve(false);
    o.arrivedStoreAt = now;
    return Promise.resolve(true);
  }

  pickUp(orderId: string, riderId: string): Promise<boolean> {
    const o = this.order(orderId);
    if (o.riderId !== riderId || o.status !== "ready") return Promise.resolve(false);
    o.status = "picked_up";
    return Promise.resolve(true);
  }

  deliver(input: {
    readonly orderId: string;
    readonly riderId: string;
    readonly proofPath: string | null;
    readonly ledger: LedgerTxn;
  }): Promise<boolean> {
    const o = this.order(input.orderId);
    if (o.riderId !== input.riderId || o.status !== "picked_up") return Promise.resolve(false);
    o.status = "delivered";
    o.proofPath = input.proofPath;
    o.deliveredAt = this.now();
    this.ledger.push(input.ledger);
    return Promise.resolve(true);
  }

  deliveryPin(orderId: string): Promise<string | null> {
    return Promise.resolve(this.order(orderId).pin);
  }

  settlementFacts(orderId: string): Promise<SettlementFacts | null> {
    const o = this.orders.find((row) => row.id === orderId);
    if (!o) return Promise.resolve(null);
    return Promise.resolve({
      orderId: o.id,
      customerId: o.customerId,
      merchantId: o.merchantId,
      paidOnline: o.paidOnline,
      subtotalCentavos: o.subtotalCentavos,
      deliveryFeeCentavos: o.deliveryFeeCentavos,
      serviceFeeCentavos: o.serviceFeeCentavos,
      smallOrderFeeCentavos: o.smallOrderFeeCentavos,
      tipCentavos: o.tipCentavos,
      discountCentavos: o.discountCentavos,
      discountFundedBy: o.discountFundedBy,
      commissionBps: o.commissionBps,
      commissionFreeUntil: o.commissionFreeUntil,
      riderPayCentavos: o.earningsCentavos ?? 0,
    });
  }

  cashHeld(riderId: string): Promise<Centavos> {
    return Promise.resolve(this.cashHeldSync(riderId));
  }

  earningsSince(
    riderId: string,
    from: Date,
  ): Promise<{ jobs: number; payCentavos: Centavos; tipCentavos: Centavos }> {
    const done = this.orders.filter(
      (o) => o.riderId === riderId && o.deliveredAt !== null && o.deliveredAt >= from,
    );
    return Promise.resolve({
      jobs: done.length,
      payCentavos: done.reduce((sum, o) => sum + (o.earningsCentavos ?? 0), 0),
      tipCentavos: done.reduce((sum, o) => sum + o.tipCentavos, 0),
    });
  }

  // --- IDeliveryProofStorage ------------------------------------------------------------------

  save(
    orderId: string,
    photo: { readonly bytes: Uint8Array; readonly contentType: string },
  ): Promise<string> {
    const ext = photo.contentType === "image/png" ? "png" : "jpg";
    const path = `${orderId}/proof-${String(this.photos.length + 1)}.${ext}`;
    this.photos.push({ path, bytes: photo.bytes.byteLength });
    return Promise.resolve(path);
  }

  // --- ITrackingRepository --------------------------------------------------------------------

  facts(orderId: string): Promise<TrackingFacts | null> {
    const o = this.orders.find((row) => row.id === orderId);
    if (!o) return Promise.resolve(null);
    const r = o.riderId ? this.rider(o.riderId) : null;
    return Promise.resolve({
      orderId: o.id,
      customerId: o.customerId,
      merchantId: o.merchantId,
      zoneId: o.zoneId,
      status: o.status,
      store: o.pickup,
      dropoff: o.dropoff,
      readyBy: o.readyBy,
      rider: r
        ? {
            firstName: r.fullName?.split(" ")[0] ?? null,
            vehicleType: r.vehicleType,
            plateNo: r.plateNo,
            location: r.location,
            locationAt: r.locationAt,
          }
        : null,
    });
  }

  private cashHeldSync(riderId: string): Centavos {
    const r = this.rider(riderId);
    const collected = this.orders
      .filter((o) => o.riderId === riderId && o.status === "delivered" && !o.paidOnline)
      .reduce((sum, o) => sum + o.totalCentavos, 0);
    return r.cashHeldCentavos + collected;
  }
}

/** Records messages instead of sending them. */
export class RecordingMessages implements IMessageSender {
  readonly sent: NotificationMessage[] = [];

  notify(message: NotificationMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}
