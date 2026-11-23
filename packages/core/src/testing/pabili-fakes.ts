import { AuthorizationService } from "../auth/authorization-service";
import type { SessionUser } from "../auth/session-user";
import type { ZoneFees } from "../catalog/ports";
import { DistanceBandFee, ZoneBaseFee } from "../catalog/fee-strategies";
import { PricingService } from "../catalog/pricing-service";
import { DispatchService } from "../dispatch/dispatch-service";
import { DistancePayRule } from "../dispatch/distance-pay-rule";
import { NearestAvailableStrategy } from "../dispatch/nearest-available-strategy";
import { PabiliFloatStrategy } from "../dispatch/pabili-float-strategy";
import { RiderService } from "../dispatch/rider-service";
import { LedgerService } from "../ordering/ledger-service";
import { OrderStateMachine } from "../ordering/order-state-machine";
import { PabiliService } from "../pabili/pabili-service";
import {
  DEFAULT_PABILI_SETTINGS,
  type CreatePabiliResult,
  type IPabiliRepository,
  type IPabiliSettings,
  type IReceiptStorage,
  type NewPabiliOrder,
  type PabiliRecord,
  type PabiliSettings,
} from "../pabili/ports";
import type { IOrderingAccess } from "../pilot/ports";
import { ServiceUnavailableError, type AppError } from "../shared/errors";
import type { Centavos } from "../shared/money";
import { err, ok, type Result } from "../shared/result";
import { InMemoryRateLimiter } from "./auth-fakes";
import { InMemoryServiceArea } from "./catalog-fakes";
import { InMemoryDispatch, RecordingMessages, type FakeDeliveryOrder } from "./dispatch-fakes";
import { FakeClock } from "./fake-clock";
import { MemoryLogger } from "./memory-logger";
import { InMemorySwitches } from "./hardening-fakes";
import { FakeContentHasher, RecordingNotifier } from "./ordering-fakes";
import { sessionUser } from "./session-users";

/** The admin's `pabili` setting, changed by tests. */
export class InMemoryPabiliSettings implements IPabiliSettings {
  value: PabiliSettings = { ...DEFAULT_PABILI_SETTINGS, enabled: true };

  current(): Promise<PabiliSettings> {
    return Promise.resolve(this.value);
  }
}

/**
 * Pabili orders in the same in-memory world as dispatch and the rider app, with the database's
 * rules: created placed then taken by Klik Go, conditional rider steps, cost within the budget.
 */
export class InMemoryPabili implements IPabiliRepository, IReceiptStorage {
  readonly receipts: { path: string; bytes: number }[] = [];
  readonly signed: string[] = [];
  storageDown = false;
  private sequence = 0;

  constructor(
    private readonly db: InMemoryDispatch,
    private readonly fees: ReadonlyMap<string, ZoneFees>,
  ) {}

  zoneFees(zoneId: string): Promise<ZoneFees | null> {
    return Promise.resolve(this.fees.get(zoneId) ?? null);
  }

  create(order: NewPabiliOrder): Promise<CreatePabiliResult> {
    const taken = this.db.orders.some(
      (o) => o.customerId === order.customerId && o.pabili?.idempotencyKey === order.idempotencyKey,
    );
    if (taken) return Promise.resolve({ kind: "duplicate" });
    this.sequence += 1;
    const id = `pabili-${String(this.sequence)}`;
    const row = this.db.addOrder({
      id,
      kind: "pabili",
      customerId: order.customerId,
      merchantId: null,
      merchantName: order.storeName,
      storeAddress: order.storeNotes,
      zoneId: order.zoneId,
      status: "accepted",
      paymentMethod: "cod",
      paidOnline: false,
      subtotalCentavos: 0,
      deliveryFeeCentavos: order.deliveryFeeCentavos,
      serviceFeeCentavos: order.serviceFeeCentavos,
      totalCentavos: order.totalCentavos,
      commissionBps: 0,
      pickup: order.pickup,
      dropoff: order.dropoff,
      dropoffBarangay: order.address.barangay ?? null,
      landmark: order.address.landmark,
      contactPhone: order.address.contactPhone,
      events: [
        ["placed", "customer"],
        ["accepted", "system"],
      ],
      pabili: {
        storeNotes: order.storeNotes,
        budgetCentavos: order.budgetCentavos,
        itemCostCentavos: null,
        receiptPath: null,
        boughtAt: null,
        idempotencyKey: order.idempotencyKey,
        requestHash: order.requestHash,
        list: order.lines.map((line) => ({ ...line, status: "pending" })),
      },
    });
    return Promise.resolve({ kind: "created", id: row.id, code: row.code });
  }

  findByIdempotencyKey(customerId: string, key: string): Promise<PabiliRecord | null> {
    const o = this.db.orders.find(
      (row) => row.customerId === customerId && row.pabili?.idempotencyKey === key,
    );
    return Promise.resolve(o ? record(o) : null);
  }

  find(orderId: string): Promise<PabiliRecord | null> {
    const o = this.db.orders.find((row) => row.id === orderId && row.kind === "pabili");
    return Promise.resolve(o ? record(o) : null);
  }

  startShopping(input: {
    readonly orderId: string;
    readonly riderId: string;
    readonly now: Date;
  }): Promise<boolean> {
    const o = this.db.order(input.orderId);
    if (o.riderId !== input.riderId || o.status !== "accepted") return Promise.resolve(false);
    o.status = "preparing";
    o.arrivedStoreAt = input.now;
    o.events.push(["preparing", "rider"]);
    return Promise.resolve(true);
  }

  recordPurchase(input: {
    readonly orderId: string;
    readonly riderId: string;
    readonly itemCostCentavos: Centavos;
    readonly receiptPath: string;
    readonly lines: readonly {
      readonly position: number;
      readonly status: "bought" | "unavailable" | "pending";
    }[];
    readonly now: Date;
  }): Promise<boolean> {
    const o = this.db.order(input.orderId);
    const p = o.pabili;
    if (!p || o.riderId !== input.riderId || o.status !== "preparing") {
      return Promise.resolve(false);
    }
    if (input.itemCostCentavos > p.budgetCentavos) {
      throw new Error("pabili_requests_within_budget");
    }
    p.itemCostCentavos = input.itemCostCentavos;
    p.receiptPath = input.receiptPath;
    p.boughtAt = input.now;
    p.list = p.list.map((line) => ({
      ...line,
      status: input.lines.find((l) => l.position === line.position)?.status ?? line.status,
    }));
    o.status = "ready";
    o.events.push(["ready", "rider"]);
    return Promise.resolve(true);
  }

  setFloat(riderId: string, floatCentavos: Centavos): Promise<void> {
    this.db.rider(riderId).pabiliFloatCentavos = floatCentavos;
    return Promise.resolve();
  }

  save(
    orderId: string,
    photo: { readonly bytes: Uint8Array; readonly contentType: string },
  ): Promise<Result<string, AppError>> {
    if (this.storageDown) {
      return Promise.resolve(err(new ServiceUnavailableError("Photo uploads are down.")));
    }
    const path = `${orderId}/receipt-${String(this.receipts.length + 1)}.jpg`;
    this.receipts.push({ path, bytes: photo.bytes.byteLength });
    return Promise.resolve(ok(path));
  }

  signedUrl(path: string, expiresInSeconds: number): Promise<string | null> {
    this.signed.push(path);
    return Promise.resolve(`https://storage.test/${path}?expires=${String(expiresInSeconds)}`);
  }
}

function record(o: FakeDeliveryOrder): PabiliRecord {
  const p = o.pabili;
  if (!p) throw new Error(`Order ${o.id} is not a Pabili order`);
  return {
    orderId: o.id,
    code: o.code,
    customerId: o.customerId,
    zoneId: o.zoneId,
    riderId: o.riderId,
    status: o.status,
    storeName: o.merchantName,
    storeNotes: p.storeNotes,
    pickup: o.pickup,
    budgetCentavos: p.budgetCentavos,
    deliveryFeeCentavos: o.deliveryFeeCentavos,
    serviceFeeCentavos: o.serviceFeeCentavos,
    totalCentavos: o.totalCentavos,
    itemCostCentavos: p.itemCostCentavos,
    receiptPath: p.receiptPath,
    boughtAt: p.boughtAt,
    requestHash: p.requestHash,
    createdAt: o.createdAt,
    lines: p.list.map((line) => ({ ...line })),
  };
}

/** A sari-sari store near Rosa and a drop-off in Bel-Air, both in the Makati zone. */
export const SARI_SARI_AT = { lat: 14.5588, lng: 121.0205 };
export const BEL_AIR = { lat: 14.5547, lng: 121.0244 };

export interface PabiliWorld {
  readonly clock: FakeClock;
  readonly logger: MemoryLogger;
  readonly db: InMemoryDispatch;
  readonly store: InMemoryPabili;
  readonly settings: InMemoryPabiliSettings;
  readonly switches: InMemorySwitches;
  readonly dispatch: DispatchService;
  readonly riders: RiderService;
  readonly pabili: PabiliService;
  readonly messages: RecordingMessages;
  /** invite_only for these tests: set to a list of customers who may order, or null (open). */
  allowOnly: string[] | null;
  riderUser(riderId: string): SessionUser;
  readonly customer: SessionUser;
}

/** Pabili, dispatch and the rider app wired with in-memory fakes (unit tests and Cucumber). */
export function pabiliWorld(now = new Date("2026-11-25T04:00:00Z")): PabiliWorld {
  const clock = new FakeClock(now);
  const logger = new MemoryLogger();
  const db = new InMemoryDispatch(() => clock.now());
  const fees = new Map<string, ZoneFees>([
    [
      "makati",
      {
        baseFeeCentavos: 3900,
        perKmCentavos: 1000,
        rules: [
          {
            kind: "delivery_distance_band",
            minDistanceM: 0,
            maxDistanceM: 2000,
            minSubtotalCentavos: null,
            feeCentavos: 3900,
            priority: 10,
          },
        ],
      },
    ],
  ]);
  const store = new InMemoryPabili(db, fees);
  const area = new InMemoryServiceArea();
  area.zones.push({
    id: "makati",
    name: "Makati City",
    slug: "makati",
    south: 14.53,
    west: 121.0,
    north: 14.58,
    east: 121.06,
  });
  const switches = new InMemorySwitches();
  const pricing = new PricingService({
    catalog: {
      loadForQuote: () => Promise.resolve(null),
    },
    serviceArea: area,
    delivery: [new DistanceBandFee(), new ZoneBaseFee()],
    surcharges: [],
    clock,
    switches,
  });
  const messages = new RecordingMessages();
  const dispatch = new DispatchService({
    repo: db,
    settings: db,
    strategy: new PabiliFloatStrategy(new NearestAvailableStrategy()),
    payRule: new DistancePayRule(),
    orders: db,
    messages,
    clock,
    logger,
  });
  const riders = new RiderService({
    riders: db,
    dispatch,
    orders: db,
    notifier: new RecordingNotifier(),
    ledger: new LedgerService(),
    proofs: db,
    limiter: new InMemoryRateLimiter(),
    clock,
    logger,
  });
  const settings = new InMemoryPabiliSettings();
  const world: PabiliWorld = {
    clock,
    logger,
    db,
    store,
    settings,
    switches,
    dispatch,
    riders,
    messages,
    allowOnly: null,
    pabili: undefined as unknown as PabiliService,
    riderUser: (riderId) => sessionUser(`user-${riderId}`, [{ role: "rider" }], "aal1"),
    customer: sessionUser("customer-1", [{ role: "customer" }], "aal1"),
  };
  const access: IOrderingAccess = {
    canOrder: (userId) =>
      Promise.resolve(world.allowOnly === null || world.allowOnly.includes(userId)),
  };
  (world as { pabili: PabiliService }).pabili = new PabiliService({
    settings,
    pabili: store,
    receipts: store,
    serviceArea: area,
    pricing,
    riders: db,
    dispatch,
    states: new OrderStateMachine(),
    authz: new AuthorizationService(),
    hasher: new FakeContentHasher(),
    clock,
    logger,
    access,
  });
  return world;
}
