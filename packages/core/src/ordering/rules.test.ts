import { ORDER_STATUSES, ORDER_STATUS_TRANSITIONS } from "@klikgo/types";
import { describe, expect, it } from "vitest";
import { ALL_DAY } from "../testing/catalog-world";
import { FakePaymentGateway } from "../testing/ordering-fakes";
import { PaymentGatewayRegistry } from "./gateway-registry";
import { LedgerService, type SettlementInput } from "./ledger-service";
import { OrderStateMachine } from "./order-state-machine";
import { deliverySlots } from "./schedule";

describe("OrderStateMachine", () => {
  const machine = new OrderStateMachine();

  it("names who may make every allowed change, and refuses every other change", () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        const allowed = ORDER_STATUS_TRANSITIONS[from].includes(to);
        expect(machine.actorsFor(from, to).length > 0, `${from} -> ${to}`).toBe(allowed);
        if (!allowed) expect(machine.check(from, to, "admin").ok).toBe(false);
      }
    }
  });

  it("lets only the payment confirmation (the system) place an order that awaited payment", () => {
    expect(machine.check("awaiting_payment", "placed", "system").ok).toBe(true);
    const customer = machine.check("awaiting_payment", "placed", "customer");
    expect(!customer.ok && customer.error.code).toBe("FORBIDDEN");
    const backwards = machine.check("delivered", "placed", "system");
    expect(!backwards.ok && backwards.error.code).toBe("CONFLICT");
  });
});

describe("LedgerService", () => {
  const ledger = new LedgerService();
  const net = (lines: readonly { debitCentavos: number; creditCentavos: number }[]) =>
    lines.reduce((sum, l) => sum + l.debitCentavos - l.creditCentavos, 0);
  const base: SettlementInput = {
    orderId: "o-1",
    customerId: "c-1",
    merchantId: "m-1",
    riderId: "r-1",
    paidOnline: true,
    subtotalCentavos: 30000,
    deliveryFeeCentavos: 3900,
    serviceFeeCentavos: 500,
    smallOrderFeeCentavos: 0,
    tipCentavos: 2000,
    discountCentavos: 5000,
    discountFundedBy: "platform",
    commissionCentavos: 4500,
    riderPayCentavos: 3500,
  };

  it("settles a delivered online order into store, rider and platform shares that balance", () => {
    const txn = ledger.settlement(base);
    expect(net(txn.lines)).toBe(0);
    const byAccount = Object.fromEntries(
      txn.lines.map((l) => [l.account, l.debitCentavos - l.creditCentavos]),
    );
    expect(byAccount).toEqual({
      customer_deposits: 31400,
      promo_expense: 5000,
      merchant_payable: -25500,
      rider_payable: -5500,
      platform_revenue: -5400,
    });
  });

  it("settles cash orders from the rider's cash and charges merchant-funded promos to the store", () => {
    const txn = ledger.settlement({ ...base, paidOnline: false, discountFundedBy: "merchant" });
    expect(net(txn.lines)).toBe(0);
    expect(txn.lines.map((l) => l.account)).toEqual([
      "rider_cash_on_hand",
      "merchant_payable",
      "rider_payable",
      "platform_revenue",
    ]);
    expect(txn.lines[1]?.creditCentavos).toBe(20500);
  });

  it("books a loss as a debit to platform revenue (0% founding commission, rider pay above fees)", () => {
    const txn = ledger.settlement({
      ...base,
      commissionCentavos: 0,
      serviceFeeCentavos: 0,
      riderPayCentavos: 5000,
    });
    expect(net(txn.lines)).toBe(0);
    expect(txn.lines.find((l) => l.account === "platform_revenue")?.debitCentavos).toBe(1100);
  });

  it("refunds after settlement as an expense instead of from the deposit", () => {
    const txn = ledger.refund({
      orderId: "o-1",
      customerId: "c-1",
      amountCentavos: 1000,
      fromDeposit: false,
    });
    expect(txn.lines.map((l) => [l.account, l.debitCentavos, l.creditCentavos])).toEqual([
      ["customer_refunds", 1000, 0],
      ["gateway_clearing", 0, 1000],
    ]);
  });
});

describe("PaymentGatewayRegistry", () => {
  it("finds gateways by method and name and lists every method once", () => {
    const online = new FakePaymentGateway();
    const cod = new FakePaymentGateway({ name: "cod", methods: ["cod"], paysUpfront: false });
    const registry = new PaymentGatewayRegistry([online, cod]);
    expect(registry.forMethod("qrph")).toBe(online);
    expect(registry.forMethod("cod")).toBe(cod);
    expect(registry.byName("cod")).toBe(cod);
    expect(registry.byName("stripe")).toBeNull();
    expect(new PaymentGatewayRegistry([cod]).forMethod("gcash")).toBeNull();
    expect(registry.availableMethods()).toEqual(["gcash", "maya", "card", "qrph", "cod"]);
  });
});

describe("deliverySlots", () => {
  const store = {
    isOpen: true,
    hours: {
      ...ALL_DAY,
      mon: [
        { open: "10:00", close: "14:00" },
        { open: "17:00", close: "20:00" },
      ],
    },
    closedDates: [],
  };

  it("offers half-hour slots inside today's opening windows, at least 45 minutes ahead", () => {
    // Monday 2 Nov 2026, 12:20 in Manila (04:20 UTC).
    const slots = deliverySlots(store, new Date("2026-11-02T04:20:00Z")).map((d) =>
      d.toISOString(),
    );
    expect(slots).toEqual([
      "2026-11-02T05:30:00.000Z",
      "2026-11-02T09:00:00.000Z",
      "2026-11-02T09:30:00.000Z",
      "2026-11-02T10:00:00.000Z",
      "2026-11-02T10:30:00.000Z",
      "2026-11-02T11:00:00.000Z",
      "2026-11-02T11:30:00.000Z",
    ]);
  });

  it("offers nothing when the store is closed for the day or switched off", () => {
    const now = new Date("2026-11-02T04:20:00Z");
    expect(deliverySlots({ ...store, closedDates: ["2026-11-02"] }, now)).toEqual([]);
    expect(deliverySlots({ ...store, isOpen: false }, now)).toEqual([]);
  });
});
