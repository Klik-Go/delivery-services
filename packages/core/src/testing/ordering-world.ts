import type { PlaceOrderRequest } from "@klikgo/types";
import { AuthorizationService } from "../auth/authorization-service";
import type { SessionUser } from "../auth/session-user";
import { DistanceBandFee, ServiceFee, SmallOrderFee, ZoneBaseFee } from "../catalog/fee-strategies";
import { PricingService } from "../catalog/pricing-service";
import { PaymentGatewayRegistry } from "../ordering/gateway-registry";
import { BackgroundJobs } from "../ordering/background-jobs";
import { LedgerService } from "../ordering/ledger-service";
import { OrderLifecycleService } from "../ordering/order-lifecycle-service";
import { OrderService, type PaymentReturnUrls } from "../ordering/order-service";
import { OrderStateMachine } from "../ordering/order-state-machine";
import { PaymentEventService } from "../ordering/payment-event-service";
import { PromoService } from "../ordering/promo-service";
import { RefundService } from "../ordering/refund-service";
import type { InMemoryCatalog } from "./catalog-fakes";
import { AYALA, catalogWorld } from "./catalog-world";
import { FakeClock } from "./fake-clock";
import { MemoryLogger } from "./memory-logger";
import {
  FakeContentHasher,
  FakePaymentGateway,
  InMemoryOrderStore,
  InMemoryPromos,
  InMemoryWebhookEvents,
  RecordingNotifier,
} from "./ordering-fakes";
import { sessionUser } from "./session-users";

/** A customer's checkout of 2 Kapeng Barako (Less sugar) from Kape't Tinapay to Ayala Avenue. */
export function barakoOrder(overrides: Partial<PlaceOrderRequest> = {}): PlaceOrderRequest {
  return {
    merchantId: "kape",
    items: [{ itemId: "item-barako", quantity: 2, optionIds: ["o-less"] }],
    dropoff: AYALA,
    address: { label: "Office", landmark: "Lobby of the blue tower", contactPhone: "09171234567" },
    paymentMethod: "cod",
    tipCentavos: 0,
    ...overrides,
  };
}

/** The checkout services and fakes {@link orderingWorld} wires together. */
export interface OrderingWorld {
  readonly catalog: InMemoryCatalog;
  readonly clock: FakeClock;
  readonly logger: MemoryLogger;
  readonly store: InMemoryOrderStore;
  readonly promoRepo: InMemoryPromos;
  readonly online: FakePaymentGateway;
  readonly cod: FakePaymentGateway;
  readonly gateways: PaymentGatewayRegistry;
  readonly webhooks: InMemoryWebhookEvents;
  readonly orders: OrderService;
  readonly refunds: RefundService;
  readonly events: PaymentEventService;
  readonly customer: SessionUser;
  readonly urls: PaymentReturnUrls;
  readonly notifier: RecordingNotifier;
  readonly lifecycle: OrderLifecycleService;
  readonly jobs: BackgroundJobs;
  /** Kape't Tinapay's owner, signed in with TOTP. */
  readonly owner: SessionUser;
}

/** Every checkout service wired with in-memory fakes (the composition root, for unit tests). */
export function orderingWorld(now = new Date("2026-11-02T03:00:00Z")): OrderingWorld {
  const { area, catalog } = catalogWorld();
  const clock = new FakeClock(now);
  const logger = new MemoryLogger();
  const authz = new AuthorizationService();
  const store = new InMemoryOrderStore({
    now: () => clock.now(),
    merchantNames: { kape: "Kape't Tinapay" },
  });
  const notifier = new RecordingNotifier();
  const promoRepo = new InMemoryPromos(store);
  const online = new FakePaymentGateway();
  const cod = new FakePaymentGateway({ name: "cod", methods: ["cod"], paysUpfront: false });
  const gateways = new PaymentGatewayRegistry([online, cod]);
  const ledger = new LedgerService();
  const states = new OrderStateMachine();
  const webhooks = new InMemoryWebhookEvents();
  const pricing = new PricingService({
    catalog,
    serviceArea: area,
    delivery: [new DistanceBandFee(), new ZoneBaseFee()],
    surcharges: [new SmallOrderFee(), new ServiceFee()],
    clock,
  });
  const promos = new PromoService({ promos: promoRepo, clock });
  const orders = new OrderService({
    pricing,
    promos,
    orders: store,
    gateways,
    hasher: new FakeContentHasher(),
    authz,
    clock,
    logger,
    notifier,
  });
  const refunds = new RefundService({
    orders: store,
    payments: store,
    gateways,
    ledger,
    authz,
    logger,
  });
  const events = new PaymentEventService({
    events: webhooks,
    payments: store,
    ledger,
    states,
    refunds,
    notifier,
    logger,
  });
  const lifecycle = new OrderLifecycleService({
    orders: store,
    lifecycle: store,
    states,
    authz,
    refunds,
    notifier,
    logger,
  });
  const jobs = new BackgroundJobs({
    notifications: { deliverQueued: () => Promise.resolve(0) },
    lifecycle: store,
    refunds,
    logger,
  });
  const owner = sessionUser("owner-kape", [{ role: "merchant_owner", merchantId: "kape" }], "aal2");
  const customer = sessionUser("customer-1", [{ role: "customer" }], "aal1");
  const urls = {
    success: (id: string) => `https://klikgo.test/orders/${id}?paid=1`,
    cancel: (id: string) => `https://klikgo.test/orders/${id}?cancelled=1`,
  };
  return {
    catalog,
    clock,
    logger,
    store,
    promoRepo,
    online,
    cod,
    gateways,
    webhooks,
    orders,
    refunds,
    events,
    customer,
    urls,
    notifier,
    lifecycle,
    jobs,
    owner,
  };
}
